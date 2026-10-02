import { expireStaleOrders, retryPendingReleases, runSubscriptionJobs } from './services/orders.js';
import { query } from './db.js';

// In-process scheduler. Every job is idempotent, so running several instances is safe
// (a Postgres advisory lock additionally keeps them from doing the same work at once).
async function guarded(name, key, fn) {
  try {
    const { rows } = await query('select pg_try_advisory_lock($1) as ok', [key]);
    if (!rows[0].ok) return;
    try { await fn(); } finally { await query('select pg_advisory_unlock($1)', [key]); }
  } catch (e) { console.error(`[job:${name}]`, e.message); }
}
export function startJobs() {
  const timers = [
    setInterval(() => guarded('expire-orders', 9001, expireStaleOrders), 60_000),
    setInterval(() => guarded('release-settlements', 9002, retryPendingReleases), 5 * 60_000),
    setInterval(() => guarded('subscriptions', 9003, runSubscriptionJobs), 60 * 60_000),
  ];
  guarded('subscriptions', 9003, runSubscriptionJobs);
  return () => timers.forEach(clearInterval);
}
