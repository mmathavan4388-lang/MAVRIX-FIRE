import { query } from '../db.js';

export async function audit(req, action, entity, entityId, meta = {}, db = { query }) {
  await db.query(
    'insert into audit_logs (actor_id, actor_role, action, entity, entity_id, meta, ip) values ($1,$2,$3,$4,$5,$6,$7)',
    [req?.user?.id ?? null, req?.user?.role ?? null, action, entity, entityId ? String(entityId) : null, meta, req?.ip ?? null],
  );
}
