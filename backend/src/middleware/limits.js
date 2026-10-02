import rateLimit from 'express-rate-limit';

const mk = (windowMs, limit, message) => rateLimit({
  windowMs, limit, standardHeaders: true, legacyHeaders: false,
  message: { error: 'rate_limited', message },
});
export const apiLimiter = mk(60_000, 300, 'Too many requests. Please slow down.');
export const loginLimiter = mk(15 * 60_000, 20, 'Too many sign-in attempts. Try again in 15 minutes.');
export const otpLimiter = mk(10 * 60_000, 5, 'Too many OTP requests. Try again later.');
export const adminLoginLimiter = mk(15 * 60_000, 8, 'Too many admin sign-in attempts. Try again in 15 minutes.');
export const uploadLimiter = mk(60_000, 30, 'Too many uploads. Please wait.');
export const supportLimiter = mk(60 * 60_000, 30, 'Too many support messages. Please wait.');
