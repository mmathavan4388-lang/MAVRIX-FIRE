import { Router } from 'express';
import { z } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import { randomInt } from 'node:crypto';
import { one, query, tx } from '../db.js';
import { config, flags } from '../config.js';
import { hashPassword, verifyPassword, sha256, safeEqualHex, newTotpSecret, verifyTotp } from '../util/crypto.js';
import { wrap, parse, HttpError, badRequest, unauthorized, forbidden, unavailable } from '../util/http.js';
import { createSession, requireUser, requireRole } from '../middleware/auth.js';
import { loginLimiter, otpLimiter, adminLoginLimiter } from '../middleware/limits.js';
import { sendOtpSms } from '../services/sms.js';
import { notifyAdmin } from '../services/notify.js';
import { audit } from '../services/audit.js';

export const auth = Router();

const phone = z.string().trim().transform((s) => s.replace(/[\s-]/g, '')).pipe(z.string().regex(/^\+?[0-9]{10,15}$/, 'Enter a valid mobile number'));
const normPhone = (p) => (/^[0-9]{10}$/.test(p) ? `+91${p}` : p.startsWith('+') ? p : `+${p}`);
const password = z.string().min(8, 'At least 8 characters').max(128);
const lang = z.enum(['en', 'ta', 'hi']);

const publicUser = (u) => ({ id: u.id, role: u.role, name: u.name, email: u.email, phone: u.phone, language: u.language,
  phoneVerified: !!u.phone_verified_at, twofaEnabled: !!u.twofa_enabled });

async function signIn(res, req, user) {
  const s = await createSession(user, req);
  res.json({ token: s.token, expiresAt: s.expiresAt, user: publicUser(user) });
}

// Constant-ish work even when the account doesn't exist, to blunt user enumeration by timing.
const DUMMY_HASH = await hashPassword('dummy-password-for-timing');
async function checkCredentials(identifier, pw, roles) {
  const isEmail = identifier.includes('@');
  const user = await one(
    `select * from users where ${isEmail ? 'email = $1' : 'phone = $1'} and deleted_at is null`,
    [isEmail ? identifier.toLowerCase() : normPhone(identifier.replace(/[\s-]/g, ''))]);
  if (!user) { await verifyPassword(pw, DUMMY_HASH); throw unauthorized('Incorrect login details'); }
  if (user.locked_until && new Date(user.locked_until) > new Date()) throw new HttpError(429, 'locked', 'Account temporarily locked. Try again in a few minutes.');
  const ok = await verifyPassword(pw, user.password_hash);
  if (!ok) {
    await query(`update users set
                   locked_until = case when failed_logins + 1 >= 5 then now() + interval '15 minutes' else locked_until end,
                   failed_logins = case when failed_logins + 1 >= 5 then 0 else failed_logins + 1 end where id = $1`, [user.id]);
    throw unauthorized('Incorrect login details');
  }
  if (!roles.includes(user.role)) throw unauthorized('Incorrect login details');
  if (user.status !== 'active') throw forbidden('This account has been blocked');
  await query('update users set failed_logins = 0, locked_until = null where id = $1', [user.id]);
  return user;
}

// ───────────── customer ─────────────
auth.post('/auth/register', loginLimiter, wrap(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email().optional(),
    phone: phone.optional(), password, language: lang.default('en') }).refine((x) => x.email || x.phone, 'Email or mobile is required'), req.body);
  const u = await one(
    `insert into users (role, name, email, phone, password_hash, language) values ('customer',$1,$2,$3,$4,$5) returning *`,
    [b.name, b.email?.toLowerCase() ?? null, b.phone ? normPhone(b.phone) : null, await hashPassword(b.password), b.language]);
  await signIn(res, req, u);
}));

auth.post('/auth/login', loginLimiter, wrap(async (req, res) => {
  const b = parse(z.object({ identifier: z.string().trim().min(3).max(120), password: z.string().min(1).max(128) }), req.body);
  await signIn(res, req, await checkCredentials(b.identifier, b.password, ['customer', 'seller']));
}));

auth.post('/auth/otp/send', otpLimiter, wrap(async (req, res) => {
  const b = parse(z.object({ phone, purpose: z.enum(['login', 'verify']).default('login') }), req.body);
  const p = normPhone(b.phone);
  if (!flags.sms()) throw unavailable('sms_not_configured', 'Mobile OTP is not configured on the server');
  const recent = await one(`select count(*)::int n from otp_codes where phone = $1 and created_at > now() - interval '1 minute'`, [p]);
  if (recent.n > 0) throw new HttpError(429, 'otp_too_soon', 'Please wait a minute before requesting another OTP');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await sendOtpSms(p, code);
  await query(`insert into otp_codes (phone, purpose, code_hash, expires_at) values ($1,$2,$3, now() + interval '5 minutes')`, [p, b.purpose, sha256(`${p}:${code}`)]);
  res.json({ sent: true });
}));

async function consumeOtp(p, code, purpose) {
  const row = await one(`select * from otp_codes where phone = $1 and purpose = $2 and consumed_at is null and expires_at > now() order by created_at desc limit 1`, [p, purpose]);
  if (!row || row.attempts >= 5) throw badRequest('otp_invalid', 'Invalid or expired OTP');
  await query('update otp_codes set attempts = attempts + 1 where id = $1', [row.id]);
  if (!safeEqualHex(row.code_hash, sha256(`${p}:${code}`))) throw badRequest('otp_invalid', 'Invalid or expired OTP');
  await query('update otp_codes set consumed_at = now() where id = $1', [row.id]);
}

auth.post('/auth/otp/verify', loginLimiter, wrap(async (req, res) => {
  const b = parse(z.object({ phone, code: z.string().regex(/^[0-9]{6}$/), name: z.string().trim().min(2).max(80).optional(), language: lang.default('en') }), req.body);
  const p = normPhone(b.phone);
  await consumeOtp(p, b.code, 'login');
  let u = await one('select * from users where phone = $1 and deleted_at is null', [p]);
  if (u && !['customer', 'seller'].includes(u.role)) throw unauthorized('Incorrect login details');
  if (u?.status === 'blocked') throw forbidden('This account has been blocked');
  if (!u) {
    if (!b.name) throw badRequest('name_required', 'Please enter your name to create your account');
    u = await one(`insert into users (role, name, phone, phone_verified_at, language) values ('customer',$1,$2,now(),$3) returning *`, [b.name, p, b.language]);
  } else if (!u.phone_verified_at) {
    u = await one('update users set phone_verified_at = now() where id = $1 returning *', [u.id]);
  }
  await signIn(res, req, u);
}));

auth.post('/me/phone/verify', requireUser, otpLimiter, wrap(async (req, res) => {
  const b = parse(z.object({ code: z.string().regex(/^[0-9]{6}$/) }), req.body);
  if (!req.user.phone) throw badRequest('no_phone', 'Add a mobile number first');
  await consumeOtp(req.user.phone, b.code, 'verify');
  await query('update users set phone_verified_at = now() where id = $1', [req.user.id]);
  res.json({ verified: true });
}));

let googleClient;
auth.post('/auth/google', loginLimiter, wrap(async (req, res) => {
  if (!flags.google()) throw unavailable('google_not_configured', 'Google sign-in is not configured on the server');
  const { idToken } = parse(z.object({ idToken: z.string().min(20), language: lang.default('en') }), req.body);
  googleClient ??= new OAuth2Client(config.googleClientId);
  let payload;
  try { payload = (await googleClient.verifyIdToken({ idToken, audience: config.googleClientId })).getPayload(); }
  catch { throw unauthorized('Google sign-in failed'); }
  if (!payload?.email_verified) throw unauthorized('Google email not verified');
  let u = await one('select * from users where google_sub = $1 or email = $2', [payload.sub, payload.email.toLowerCase()]);
  if (u && !['customer', 'seller'].includes(u.role)) throw unauthorized('Google sign-in failed');
  if (u?.status === 'blocked') throw forbidden('This account has been blocked');
  if (!u) u = await one(`insert into users (role, name, email, email_verified_at, google_sub, language) values ('customer',$1,$2,now(),$3,$4) returning *`,
    [payload.name || payload.email.split('@')[0], payload.email.toLowerCase(), payload.sub, req.body.language ?? 'en']);
  else if (!u.google_sub) u = await one('update users set google_sub = $2, email_verified_at = coalesce(email_verified_at, now()) where id = $1 returning *', [u.id, payload.sub]);
  await signIn(res, req, u);
}));

// ───────────── seller registration (reviewed by Admin) ─────────────
auth.post('/auth/register-seller', loginLimiter, wrap(async (req, res) => {
  const b = parse(z.object({
    shopName: z.string().trim().min(2).max(100), ownerName: z.string().trim().min(2).max(100),
    phone, email: z.string().trim().email(), password,
    address: z.string().trim().min(10).max(400), pincode: z.string().regex(/^[0-9]{6}$/),
    citySlug: z.string().default('sivakasi'), description: z.string().trim().max(1500).default(''),
    pickupEnabled: z.boolean().default(true), deliveryEnabled: z.boolean().default(false), language: lang.default('en'),
  }), req.body);
  const city = await one('select id from cities where slug = $1 and is_active', [b.citySlug]);
  if (!city) throw badRequest('city_unavailable', 'We are not yet available in this city');
  const user = await tx(async (c) => {
    const u = await c.one(`insert into users (role, name, email, phone, password_hash, language) values ('seller',$1,$2,$3,$4,$5) returning *`,
      [b.ownerName, b.email.toLowerCase(), normPhone(b.phone), await hashPassword(b.password), b.language]);
    const slugBase = b.shopName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'shop';
    await c.one(
      `insert into shops (owner_id, city_id, slug, name, owner_name, phone, email, address, pincode, description, pickup_enabled, delivery_enabled)
       values ($1,$2,$3 || '-' || substr(gen_random_uuid()::text,1,6),$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [u.id, city.id, slugBase, b.shopName, b.ownerName, normPhone(b.phone), b.email, b.address, b.pincode, b.description, b.pickupEnabled, b.deliveryEnabled]);
    await notifyAdmin('new_seller', { shop: b.shopName }, {}, c);
    return u;
  });
  await signIn(res, req, user);
}));

// ───────────── session / profile ─────────────
auth.get('/me', requireUser, wrap(async (req, res) => {
  const u = await one('select * from users where id = $1', [req.user.id]);
  res.json({ user: publicUser(u) });
}));
auth.patch('/me', requireUser, wrap(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(80).optional(), language: lang.optional() }), req.body);
  const u = await one('update users set name = coalesce($2,name), language = coalesce($3,language) where id = $1 returning *', [req.user.id, b.name ?? null, b.language ?? null]);
  res.json({ user: publicUser(u) });
}));
auth.post('/auth/logout', requireUser, wrap(async (req, res) => {
  await query('update sessions set revoked_at = now() where id = $1', [req.sessionId]);
  res.json({ ok: true });
}));
auth.post('/auth/logout-all', requireUser, wrap(async (req, res) => {
  await query('update sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [req.user.id]);
  if (req.user.role === 'admin') await audit(req, 'admin.logout_all', 'user', req.user.id);
  res.json({ ok: true });
}));

// ───────────── ADMIN: one-time setup + login ─────────────
const adminPassword = z.string().min(12, 'At least 12 characters').max(128)
  .regex(/[a-z]/, 'Needs a lowercase letter').regex(/[A-Z]/, 'Needs an uppercase letter').regex(/[0-9]/, 'Needs a number');

auth.get('/admin/setup/status', wrap(async (_req, res) => {
  const exists = await one(`select 1 from users where role = 'admin'`);
  res.json({ setupAvailable: !exists, tokenConfigured: !!config.adminSetupToken });
}));

auth.post('/admin/setup', adminLoginLimiter, wrap(async (req, res) => {
  const b = parse(z.object({ email: z.string().trim().email(), password: adminPassword, confirmPassword: z.string(), setupToken: z.string().min(1) })
    .refine((x) => x.password === x.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] }), req.body);
  if (!config.adminSetupToken) throw unavailable('setup_not_configured', 'ADMIN_SETUP_TOKEN is not set on the server');
  if (!safeEqualHex(sha256(b.setupToken), sha256(config.adminSetupToken))) throw forbidden('Invalid setup token');
  let admin;
  try {
    admin = await one(`insert into users (role, name, email, email_verified_at, password_hash) values ('admin','Administrator',$1,now(),$2) returning *`,
      [b.email.toLowerCase(), await hashPassword(b.password)]);
  } catch (e) {
    if (e.code === '23505' && e.constraint === 'users_single_admin') throw new HttpError(403, 'setup_closed', 'Admin setup has already been completed');
    if (e.code === '23505') throw new HttpError(409, 'email_in_use', 'This email is already registered as another account. Use a different email for the admin.');
    throw e;
  }
  req.user = { id: admin.id, role: 'admin' };
  await audit(req, 'admin.setup_completed', 'user', admin.id);
  await signIn(res, req, admin);
}));

auth.post('/admin/login', adminLoginLimiter, wrap(async (req, res) => {
  const b = parse(z.object({ email: z.string().trim().email(), password: z.string().min(1).max(128), otp: z.string().optional() }), req.body);
  const u = await checkCredentials(b.email, b.password, ['admin']);
  if (u.twofa_enabled) {
    if (!b.otp) return res.status(401).json({ error: 'otp_required', message: 'Enter your authenticator code' });
    if (!verifyTotp(u.twofa_secret, b.otp)) throw unauthorized('Incorrect authenticator code');
  }
  req.user = { id: u.id, role: 'admin' };
  await audit(req, 'admin.login', 'user', u.id);
  await signIn(res, req, u);
}));

const adminOnly = [requireRole('admin')];
auth.post('/admin/2fa/setup', ...adminOnly, wrap(async (req, res) => {
  const secret = newTotpSecret();
  await query('update users set twofa_secret = $2, twofa_enabled = false where id = $1', [req.user.id, secret]);
  const u = await one('select email from users where id = $1', [req.user.id]);
  res.json({ secret, otpauthUri: `otpauth://totp/MAVRIX%20FIRE:${encodeURIComponent(u.email)}?secret=${secret}&issuer=MAVRIX%20FIRE` });
}));
auth.post('/admin/2fa/enable', ...adminOnly, wrap(async (req, res) => {
  const { code } = parse(z.object({ code: z.string().regex(/^[0-9]{6}$/) }), req.body);
  const u = await one('select twofa_secret from users where id = $1', [req.user.id]);
  if (!u.twofa_secret || !verifyTotp(u.twofa_secret, code)) throw badRequest('bad_code', 'Incorrect code');
  await query('update users set twofa_enabled = true where id = $1', [req.user.id]);
  await audit(req, 'admin.2fa_enabled', 'user', req.user.id);
  res.json({ enabled: true });
}));
auth.post('/admin/2fa/disable', ...adminOnly, wrap(async (req, res) => {
  const b = parse(z.object({ password: z.string(), code: z.string().regex(/^[0-9]{6}$/) }), req.body);
  const u = await one('select * from users where id = $1', [req.user.id]);
  if (!(await verifyPassword(b.password, u.password_hash)) || !verifyTotp(u.twofa_secret, b.code)) throw unauthorized('Incorrect password or code');
  await query('update users set twofa_enabled = false, twofa_secret = null where id = $1', [req.user.id]);
  await audit(req, 'admin.2fa_disabled', 'user', req.user.id);
  res.json({ enabled: false });
}));
auth.post('/admin/password', ...adminOnly, wrap(async (req, res) => {
  const b = parse(z.object({ current: z.string(), next: adminPassword }), req.body);
  const u = await one('select * from users where id = $1', [req.user.id]);
  if (!(await verifyPassword(b.current, u.password_hash))) throw unauthorized('Current password is incorrect');
  await query('update users set password_hash = $2 where id = $1', [u.id, await hashPassword(b.next)]);
  await query('update sessions set revoked_at = now() where user_id = $1 and id <> $2 and revoked_at is null', [u.id, req.sessionId]);
  await audit(req, 'admin.password_changed', 'user', u.id);
  res.json({ ok: true });
}));
