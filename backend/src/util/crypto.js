import { randomBytes, scrypt, timingSafeEqual, createHash, createHmac } from 'node:crypto';

const scryptAsync = (pw, salt, len, opts) => new Promise((res, rej) => scrypt(pw, salt, len, opts, (e, k) => (e ? rej(e) : res(k))));

// scrypt with per-password salt; parameters embedded so they can be raised later.
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const N = 32768, r = 8, p = 1;
  const key = await scryptAsync(password, salt, 64, { N, r, p, maxmem: 128 * N * r * 2 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [alg, N, r, p, salt, key] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(key, 'base64');
  const got = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p, maxmem: 128 * +N * +r * 2 });
  return timingSafeEqual(got, expected);
}
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const hmacHex = (secret, data) => createHmac('sha256', secret).update(data).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const safeEqualHex = (a, b) => {
  const x = Buffer.from(String(a), 'utf8'), y = Buffer.from(String(b), 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
};

// RFC 6238 TOTP (SHA1, 6 digits, 30s) — optional admin 2FA with any authenticator app.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const newTotpSecret = () => {
  const b = randomBytes(20); let bits = '', out = '';
  for (const x of b) bits += x.toString(2).padStart(8, '0');
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
};
function b32decode(s) {
  let bits = '';
  for (const ch of s.replace(/=+$/, '')) bits += B32.indexOf(ch).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
export function totp(secret, t = Date.now()) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = createHmac('sha1', b32decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
  return code;
}
export const verifyTotp = (secret, code) =>
  [-1, 0, 1].some((w) => safeEqualHex(totp(secret, Date.now() + w * 30000), String(code).trim()));
