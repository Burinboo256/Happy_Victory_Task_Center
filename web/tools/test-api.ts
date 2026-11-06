import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFile, rm } from 'node:fs/promises';
import { Pool } from 'pg';
import { environment, repository, migrationSql } from '../tests/fixtures';
import { readConfig } from '../src/server/config';
import { createSession } from '../src/server/auth/session';

const raw = process.env.TEST_DATABASE_URL;
if (!raw || !/test/i.test(new URL(raw).pathname) || raw === process.env.DATABASE_URL)
  throw new Error('TEST_DATABASE_URL must identify a separate disposable test database');
const schema = 'hvr_http_' + randomUUID().replaceAll('-', '');
const controlFile = resolve(tmpdir(), schema + '.json');
const admin = new Pool({ connectionString: raw, max: 1 });
const url = new URL(raw);
url.searchParams.set('options', '-c search_path=' + schema);
const db = new Pool({ connectionString: url.href, max: 3 });
try {
  await writeFile(controlFile, '{}', { flag: 'wx' });
  await admin.query('CREATE SCHEMA ' + schema);
  for (const sql of await migrationSql()) await db.query(sql);
  const env = {
    ...process.env,
    ...environment,
    VERCEL_ENV: '',
    DATABASE_URL: url.href,
    APP_ORIGIN: 'http://127.0.0.1:4181',
    NEXT_TELEMETRY_DISABLED: '1',
    JOBS_ENABLED: 'false',
    ENABLE_EMAIL_NOTIFICATIONS: 'false',
    ENABLE_LINE_NOTIFICATIONS: 'false',
    HVR_TEST_CONTROL_FILE: controlFile,
  };
  const config = readConfig(env),
    h = repository();
  await db.query('INSERT INTO hvr_instances(environment,base_id) VALUES ($1,$2)', [
    config.APP_ENV,
    config.AIRTABLE_BASE_ID,
  ]);
  await db.query('INSERT INTO hvr_runtime(environment,task_writes) VALUES ($1,true)', [
    config.APP_ENV,
  ]);
  const agent = await createSession(db, config, h.agent),
    other = await createSession(db, config, h.other),
    secretary = await createSession(db, config, h.secretary);
  const sessionEnv = {
    HVR_TEST_AGENT_TOKEN: agent.token,
    HVR_TEST_OTHER_TOKEN: other.token,
    HVR_TEST_SECRETARY_TOKEN: secretary.token,
  };
  const code = await new Promise<number | null>((done, reject) => {
    const child = spawn(
      process.execPath,
      ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.api.config.ts'],
      {
        env: {
          ...env,
          ...sessionEnv,
          NODE_OPTIONS:
            '--import=tsx --import=' +
            pathToFileURL(resolve('tests/support/server-doubles.ts')).href,
        },
        stdio: 'inherit',
        windowsHide: true,
      },
    );
    child.on('error', reject);
    child.on('close', done);
  });
  process.exitCode = code === 0 ? 0 : 1;
} finally {
  await db.end();
  if (/^hvr_http_[a-f0-9]{32}$/.test(schema))
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
  else process.exitCode = 1;
  await admin.end();
  await rm(controlFile, { force: true });
}
