import { query, one } from '../db.js';

/**
 * In-app notification. `kind` maps to translated text on the client (notif.<kind>), so each
 * user reads it in their own language. Pass dedupeKey to make repeats (e.g. expiry reminders) idempotent.
 */
export async function notify(userId, kind, data = {}, { title, body, dedupeKey } = {}, db = { query }) {
  if (!userId) return;
  await db.query(
    `insert into notifications (user_id, kind, title, body, data, dedupe_key) values ($1,$2,$3,$4,$5,$6)
     on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing`,
    [userId, kind, title ?? null, body ?? null, data, dedupeKey ?? null],
  );
}

export async function adminUserId(db = { one }) {
  const r = await db.one("select id from users where role = 'admin' and deleted_at is null");
  return r?.id ?? null;
}
export async function notifyAdmin(kind, data = {}, opts = {}, db = { one, query }) {
  const id = await adminUserId(db);
  if (id) await notify(id, kind, data, opts, db);
}
