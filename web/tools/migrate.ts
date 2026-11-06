import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { localEnvironment } from './environment';
import { getPool, transaction } from '../src/server/db';
import { readMigrationConfig } from '../src/server/config';

let db: ReturnType<typeof getPool> | undefined;
try {
  const config = readMigrationConfig(localEnvironment());
  db = getPool(config);
  await transaction(db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(817204321)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS hvr_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const name of (await readdir('db/migrations'))
      .filter((n) => /^\d+_[a-z_]+\.sql$/.test(n))
      .sort()) {
      const sql = await readFile('db/migrations/' + name, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const old = await client.query('SELECT checksum FROM hvr_migrations WHERE name=$1', [name]);
      if (old.rows.length) {
        if (old.rows[0].checksum !== checksum)
          throw new Error('Migration changed after application: ' + name);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO hvr_migrations(name,checksum) VALUES ($1,$2)', [
        name,
        checksum,
      ]);
      console.log('Applied ' + name);
    }
    const binding = await client.query(
      `INSERT INTO hvr_instances(environment,base_id) VALUES ($1,$2)
      ON CONFLICT(environment) DO UPDATE SET base_id=hvr_instances.base_id WHERE hvr_instances.base_id=EXCLUDED.base_id RETURNING base_id`,
      [config.APP_ENV, config.AIRTABLE_BASE_ID],
    );
    if (!binding.rows.length)
      throw new Error('Environment binding conflicts; no migrations committed');
    await client.query('INSERT INTO hvr_runtime(environment) VALUES ($1) ON CONFLICT DO NOTHING', [
      config.APP_ENV,
    ]);
  });
  console.log('Schema ready; runtime writes and jobs retain their previous state.');
} catch {
  console.error(
    'Migration failed; transaction rolled back. Check connectivity, privileges and migration checksums.',
  );
  process.exitCode = 1;
} finally {
  await db?.end();
}
