import pg from 'pg';
import { config } from './config.js';

// Return int8 (counts/sums) as numbers; all money columns here are int4 paise anyway.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
  statement_timeout: 15000,
});

export const query = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0] ?? null;
export const many = async (text, params) => (await pool.query(text, params)).rows;

/** Run fn inside a transaction. fn receives a client with the same helpers. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const c = {
      query: (t, p) => client.query(t, p),
      one: async (t, p) => (await client.query(t, p)).rows[0] ?? null,
      many: async (t, p) => (await client.query(t, p)).rows,
    };
    const out = await fn(c);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function getSetting(key, fallback = null, db = { one }) {
  const r = await db.one('select value from settings where key = $1', [key]);
  return r ? r.value : fallback;
}
