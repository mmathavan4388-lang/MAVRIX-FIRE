import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { pool } from './db.js';
import { loadUser } from './middleware/auth.js';
import { apiLimiter } from './middleware/limits.js';
import { errorHandler } from './util/http.js';
import { webhooks } from './routes/webhooks.js';
import { auth } from './routes/auth.js';
import { pub } from './routes/public.js';
import { customer } from './routes/customer.js';
import { seller } from './routes/seller.js';
import { admin } from './routes/admin.js';

export function createApp() {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://checkout.razorpay.com', 'https://accounts.google.com'],
      frameSrc: ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com', 'https://accounts.google.com'],
      connectSrc: ["'self'", 'https://*.razorpay.com', 'https://lumberjack.razorpay.com', 'https://accounts.google.com'],
      imgSrc: ["'self'", 'data:', 'blob:', ...(config.storage.publicBaseUrl ? [new URL(config.storage.publicBaseUrl).origin] : [])],
      styleSrc: ["'self'", "'unsafe-inline'"], fontSrc: ["'self'", 'data:'], objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"],
    } },
    hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cors({ origin: config.corsOrigins.length ? config.corsOrigins : false, credentials: false }));
  app.use(compression());

  app.get('/healthz', async (_req, res) => {
    try { await pool.query('select 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
  });

  // Webhook first: needs the raw body, bypasses auth and the JSON parser.
  app.use('/api/webhooks', express.raw({ type: '*/*', limit: '1mb' }), webhooks);

  app.use('/api', express.json({ limit: '200kb' }), apiLimiter, loadUser, auth, pub, customer, seller, admin);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found', message: 'Unknown endpoint' }));

  // Serve the built web app (single-service deployment).
  const dist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
  if (existsSync(dist)) {
    app.use(express.static(dist, { maxAge: '1h', setHeaders: (r, p) => { if (p.includes('/assets/')) r.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
