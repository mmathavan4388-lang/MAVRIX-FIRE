// Versioned, forward-only migrations. Applied files are checksummed; editing an applied file is refused.
// Future releases add NEW numbered files; existing data is never dropped by the runner.
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './db.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrate({ log = console.log } = {}) {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(727274)');
    await client.query(`create table if not exists schema_migrations (
      name text primary key, checksum text not null, applied_at timestamptz not null default now())`);
    const applied = new Map((await client.query('select name, checksum from schema_migrations')).rows.map((r) => [r.name, r.checksum]));
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    let count = 0;
    for (const f of files) {
      const sql = readFileSync(join(dir, f), 'utf8');
      const sum = createHash('sha256').update(sql).digest('hex');
      if (applied.has(f)) {
        if (applied.get(f) !== sum) throw new Error(`Migration ${f} was modified after being applied. Add a new migration instead.`);
        continue;
      }
      log(`applying ${f}`);
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (name, checksum) values ($1,$2)', [f, sum]);
        await client.query('commit');
        count++;
      } catch (e) {
        await client.query('rollback');
        throw new Error(`Migration ${f} failed: ${e.message}`);
      }
    }
    log(count ? `applied ${count} migration(s)` : 'database is up to date');
  } finally {
    await client.query('select pg_advisory_unlock(727274)').catch(() => {});
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e.message); process.exit(1); });
}
