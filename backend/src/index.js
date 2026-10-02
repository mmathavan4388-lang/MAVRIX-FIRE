import { config, flags } from './config.js';
import { migrate } from './migrate.js';
import { createApp } from './app.js';
import { startJobs } from './jobs.js';
import { pool } from './db.js';

await migrate();   // forward-only migrations on boot; never destructive
const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`MAVRIX FIRE API listening on :${config.port}`);
  const missing = Object.entries({ payments: flags.payments(), webhooks: flags.webhooks(), storage: flags.storage(), sms: flags.sms(), google: flags.google(), adminSetupToken: !!config.adminSetupToken })
    .filter(([, ok]) => !ok).map(([k]) => k);
  if (missing.length) console.warn(`Not configured (those features return 503 until set): ${missing.join(', ')}`);
});
const stopJobs = startJobs();
const shutdown = () => { stopJobs(); server.close(() => pool.end().then(() => process.exit(0))); setTimeout(() => process.exit(1), 10000).unref(); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
