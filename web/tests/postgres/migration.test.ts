import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Pool } from 'pg';
import { environment, migrationSql } from '../fixtures';

function migrate(env: Record<string, string>) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'tools/migrate.ts'], {
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}

test('migration CLI is idempotent, binds the environment and rolls back changed-checksum failures', async () => {
  const raw = process.env.TEST_DATABASE_URL;
  assert.ok(raw, 'TEST_DATABASE_URL is required');
  assert.match(new URL(raw).pathname, /test/i);
  assert.notEqual(raw, process.env.DATABASE_URL);
  // The control plane intentionally uses public, so isolate the whole database.
  // A search_path-only fixture cannot exercise the production migration layout.
  const database = 'hvr_test_' + randomUUID().replaceAll('-', '');
  const db = new Pool({ connectionString: raw, max: 1 });
  const url = new URL(raw);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  url.pathname = '/' + database;
  url.searchParams.delete('options');
  const env = {
    ...environment,
    DATABASE_URL: url.href,
    DATABASE_MIGRATION_URL: '',
    APP_ORIGIN: '',
    AIRTABLE_TOKEN: '',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    AUTH_SECRET: '',
  };
  const query = new Pool({ connectionString: url.href, max: 1 });
  try {
    await db.query('CREATE DATABASE ' + database);
    const first = await migrate(env);
    assert.equal(first.code, 0, first.output);
    const second = await migrate(env);
    assert.equal(second.code, 0, second.output);
    assert.equal(second.output.includes('Applied 001_runtime.sql'), false);
    assert.equal(
      (await query.query('SELECT * FROM hvr_migrations')).rows.length,
      (await migrationSql()).length,
    );
    assert.equal(
      (await query.query('SELECT task_writes,jobs FROM hvr_runtime')).rows[0].task_writes,
      false,
    );
    const mismatch = await migrate({ ...env, AIRTABLE_BASE_ID: 'app00000000000009' });
    assert.equal(mismatch.code, 1);
    assert.equal(
      (await query.query('SELECT base_id FROM hvr_instances')).rows[0].base_id,
      environment.AIRTABLE_BASE_ID,
    );
    await query.query("UPDATE hvr_migrations SET checksum='invalid'");
    const bad = await migrate(env);
    assert.equal(bad.code, 1);
    assert.equal(bad.output.includes('Migration failed'), true);
    assert.equal(bad.output.includes('test-secret-never-live'), false);
  } finally {
    await query.end();
    assert.match(database, /^hvr_test_[a-f0-9]{32}$/);
    await db.query('DROP DATABASE IF EXISTS ' + database);
    await db.end();
  }
});
