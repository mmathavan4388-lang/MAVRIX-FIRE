import { query, one } from '../db.js';
import { sha256, randomToken } from '../util/crypto.js';
import { config } from '../config.js';
import { unauthorized, forbidden } from '../util/http.js';

export async function createSession(user, req) {
  const token = randomToken(32);
  const days = config.sessionDays[user.role];
  const expires = user.role === 'admin'
    ? new Date(Date.now() + config.adminMaxHours * 3600_000)
    : new Date(Date.now() + days * 86400_000);
  await query(
    'insert into sessions (user_id, token_hash, expires_at, user_agent, ip) values ($1,$2,$3,$4,$5)',
    [user.id, sha256(token), expires, String(req.get('user-agent') || '').slice(0, 300), req.ip],
  );
  return { token, expiresAt: expires };
}

/** Attaches req.user when a valid bearer token is present. Never throws for anonymous requests. */
export async function loadUser(req, _res, next) {
  try {
    const h = req.get('authorization') || '';
    if (!h.startsWith('Bearer ')) return next();
    const token = h.slice(7);
    const s = await one(
      `select s.id as sid, s.last_seen_at, u.id, u.role, u.name, u.email, u.phone, u.language, u.status, u.twofa_enabled
         from sessions s join users u on u.id = s.user_id
        where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now() and u.deleted_at is null`,
      [sha256(token)],
    );
    if (!s || s.status !== 'active') return next();
    if (s.role === 'admin') {
      const idleMs = Date.now() - new Date(s.last_seen_at).getTime();
      if (idleMs > config.adminIdleMinutes * 60_000) {
        await query('update sessions set revoked_at = now() where id = $1', [s.sid]);
        return next();
      }
    }
    // Sliding activity marker (throttled to once a minute).
    if (Date.now() - new Date(s.last_seen_at).getTime() > 60_000) {
      query('update sessions set last_seen_at = now() where id = $1', [s.sid]).catch(() => {});
    }
    req.user = { id: s.id, role: s.role, name: s.name, email: s.email, phone: s.phone, language: s.language, twofa: s.twofa_enabled };
    req.sessionId = s.sid;
    req.sessionToken = token;
  } catch (e) { return next(e); }
  next();
}

/** Server-side role gate. Frontend role checks are cosmetic only. */
export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};
export const requireUser = requireRole('customer', 'seller', 'admin');
