// All configuration comes from environment variables. Nothing secret lives in source.
import { existsSync } from 'node:fs';

for (const f of ['.env', '../.env']) {
  if (existsSync(f)) { try { process.loadEnvFile(f); } catch { /* ignore */ } }
}

const env = process.env;
const isProd = env.NODE_ENV === 'production';

function required(name) {
  const v = env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const config = {
  isProd,
  port: Number(env.PORT || 8080),
  databaseUrl: required('DATABASE_URL'),
  databaseSsl: env.DATABASE_SSL === 'true',
  publicUrl: env.PUBLIC_URL || `http://localhost:${env.PORT || 8080}`,
  corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  trustProxy: env.TRUST_PROXY === 'true' || isProd,

  // One-time First Admin Setup is protected by this token so nobody who finds the URL first can claim admin.
  adminSetupToken: env.ADMIN_SETUP_TOKEN || '',

  sessionDays: { customer: 30, seller: 30 },
  adminIdleMinutes: Number(env.ADMIN_IDLE_MINUTES || 30),
  adminMaxHours: Number(env.ADMIN_MAX_SESSION_HOURS || 12),

  razorpay: {
    keyId: env.RAZORPAY_KEY_ID || '',
    keySecret: env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || '',
  },
  storage: {
    bucket: env.S3_BUCKET || '',
    region: env.S3_REGION || 'auto',
    endpoint: env.S3_ENDPOINT || '',
    accessKeyId: env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: env.S3_SECRET_ACCESS_KEY || '',
    publicBaseUrl: (env.S3_PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  },
  googleClientId: env.GOOGLE_CLIENT_ID || '',
  sms: {
    // MSG91 (India, DLT-compliant). Template must be pre-approved under DLT.
    msg91AuthKey: env.MSG91_AUTH_KEY || '',
    msg91TemplateId: env.MSG91_TEMPLATE_ID || '',
  },
};

export const flags = {
  payments: () => !!(config.razorpay.keyId && config.razorpay.keySecret),
  webhooks: () => !!config.razorpay.webhookSecret,
  storage: () => !!(config.storage.bucket && config.storage.accessKeyId && config.storage.secretAccessKey && config.storage.publicBaseUrl),
  google: () => !!config.googleClientId,
  sms: () => !!(config.sms.msg91AuthKey && config.sms.msg91TemplateId),
};
