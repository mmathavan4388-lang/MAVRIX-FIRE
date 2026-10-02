import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const mk = (windowMs, limit, message) => rateLimit({
  windowMs, limit, standardHeaders: true, legacyHeaders: false,
  message: { error: 'rate_limited', message },
});
// Mobile carriers put many users behind one IP, so signed-in traffic is limited per session token, anonymous per IP.
export const apiLimiter = rateLimit({
  windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => { const a = req.get('authorization'); return a ? `t:${a.slice(-24)}` : ipKeyGenerator(req.ip); },
  message: { error: 'rate_limited', message: 'Too many requests. Please slow down.' },
});
export const loginLimiter = mk(15 * 60_000, 60, 'Too many sign-in attempts. Try again in 15 minutes.');
export const otpLimiter = mk(10 * 60_000, 5, 'Too many OTP requests. Try again later.');
export const adminLoginLimiter = mk(15 * 60_000, 8, 'Too many admin sign-in attempts. Try again in 15 minutes.');
export const uploadLimiter = mk(60_000, 30, 'Too many uploads. Please wait.');
export const supportLimiter = mk(60 * 60_000, 30, 'Too many support messages. Please wait.');
