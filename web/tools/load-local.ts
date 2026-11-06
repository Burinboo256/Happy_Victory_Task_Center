import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { environment, migrationSql, rid } from '../tests/fixtures';
import { readConfig } from '../src/server/config';
import { createSession } from '../src/server/auth/session';
import { cookieName } from '../src/server/auth/security';

const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = /^--(users|tasks|delay-ms)=(\d+)$/.exec(arg);
    if (!match) throw new Error('Use --users=1..20 --tasks=1..5000 --delay-ms=0..500');
    return [match[1], Number(match[2])];
  }),
);
const users = options.users ?? 5,
  tasks = options.tasks ?? 250,
  delayMs = options['delay-ms'] ?? 60;
assert.ok(users >= 1 && users <= 20 && tasks >= 1 && tasks <= 5000 && delayMs <= 500);
const raw = process.env.TEST_DATABASE_URL;
if (!raw || !/test/i.test(new URL(raw).pathname) || raw === process.env.DATABASE_URL)
  throw new Error('TEST_DATABASE_URL must identify a separate disposable test database');
const runId = randomUUID(),
  schema = `hvr_load_${runId.replaceAll('-', '')}`;
const controlFile = resolve(tmpdir(), `${schema}.json`);
const url = new URL(raw);
url.searchParams.set('options', `-c search_path=${schema}`);
const db = new Pool({ connectionString: url.href, max: 3 });
const admin = new Pool({ connectionString: raw, max: 1 });
const env = {
  ...process.env,
  ...environment,
  DATABASE_URL: url.href,
  APP_ORIGIN: 'http://127.0.0.1:4182',
  VERCEL_ENV: '',
  TASK_WRITES_ENABLED: 'false',
  JOBS_ENABLED: 'false',
  ENABLE_EMAIL_NOTIFICATIONS: 'false',
  ENABLE_LINE_NOTIFICATIONS: 'false',
  NEXT_TELEMETRY_DISABLED: '1',
  AIRTABLE_SCHEMA_TOKEN: '',
  HVR_LOAD_CONTROL_FILE: controlFile,
  NODE_OPTIONS: `--import=${pathToFileURL(resolve('tests/support/load-upstream.mjs')).href}`,
};
const config = readConfig(env);
let server: ChildProcess | undefined;
let serverClosed: Promise<void> | undefined;
const report: Record<string, unknown> = {
  runId,
  startedAt: new Date().toISOString(),
  users,
  tasks,
  upstreamDelayMs: delayMs,
  scope:
    'local production HTTP + real PostgreSQL; synthetic sessions and Airtable; no Google/cloud latency',
  passed: false,
};
const samples: { phase: string; status: number; code?: string; ms: number; retryAfter?: number }[] =
  [];
try {
  // Never reuse an existing server with unknown environment/session bindings.
  try {
    await fetch(`${config.APP_ORIGIN}/api/health`, { signal: AbortSignal.timeout(1000) });
    throw new Error('Port 4182 already serves HTTP; stop that server before this test');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Port 4182')) throw error;
  }
  await writeFile(controlFile, JSON.stringify({ users, tasks, delayMs }), { flag: 'wx' });
  await admin.query(`CREATE SCHEMA ${schema}`);
  for (const sql of await migrationSql()) await db.query(sql);
  await db.query('INSERT INTO hvr_instances(environment,base_id) VALUES ($1,$2)', [
    config.APP_ENV,
    config.AIRTABLE_BASE_ID,
  ]);
  await db.query('INSERT INTO hvr_runtime(environment,task_writes) VALUES ($1,false)', [
    config.APP_ENV,
  ]);
  const sessions = await Promise.all(
    Array.from({ length: users + 1 }, (_, i) =>
      createSession(db, config, { id: rid(i + 1), sub: `load-${i}` }),
    ),
  );
  server = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '4182'],
    {
      env,
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  let exited = false;
  let startFailed = false;
  serverClosed = new Promise<void>((done) => {
    server?.once('error', () => {
      startFailed = true;
      exited = true;
      done();
    });
    server?.once('close', () => {
      exited = true;
      done();
    });
  });
  const startupDeadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < startupDeadline && !exited) {
    try {
      ready = (
        await fetch(`${config.APP_ORIGIN}/api/health`, { signal: AbortSignal.timeout(1000) })
      ).ok;
    } catch {
      /* starting */
    }
    if (ready) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(ready && !startFailed && !exited, 'Isolated production build must start');
  const request = async (phase: string, index: number, context = false) => {
    const start = performance.now();
    const response = await fetch(
      `${config.APP_ORIGIN}/api/bootstrap${context ? '?scope=context' : ''}`,
      {
        headers: { Cookie: `${cookieName(config, 'session')}=${sessions[index].token}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    const body = await response.json();
    const sample = {
      phase,
      status: response.status,
      code: body.error?.code as string | undefined,
      ms: Math.round(performance.now() - start),
      retryAfter: Number(response.headers.get('retry-after')) || undefined,
    };
    samples.push(sample);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    if (response.ok) {
      assert.equal(body.user.id, rid(index + 1));
      assert.equal(body.tasksIncluded, !context);
      const expected = context
        ? 0
        : index === 0
          ? tasks
          : Math.floor((tasks - index + users) / users);
      assert.equal(body.tasks.length, expected, 'no task truncation under load');
      assert.ok(
        index === 0 ||
          body.tasks.every((task: { agentId: string }) => task.agentId === rid(index + 1)),
        'ownership isolation',
      );
      assert.ok(
        !JSON.stringify(body).includes('Google Subject'),
        'no identity subject in response',
      );
    } else {
      assert.equal(response.status, 503);
      assert.equal(body.error?.code, 'AIRTABLE_BUSY');
      assert.ok(sample.retryAfter && sample.retryAfter > 0);
    }
    return sample;
  };
  for (let i = 0; i < 3; i++) assert.equal((await request('manager-full', 0)).status, 200);
  const contextBefore = JSON.parse(await readFile(controlFile, 'utf8'));
  for (let i = 1; i <= users; i++)
    assert.equal((await request('agent-context', i, true)).status, 200);
  const contextAfter = JSON.parse(await readFile(controlFile, 'utf8'));
  assert.equal(
    contextAfter.userChecks - contextBefore.userChecks,
    users,
    'every context request rechecks the user',
  );
  assert.equal(contextAfter.tasksPages, contextBefore.tasksPages, 'context must not list tasks');
  const burst = await Promise.allSettled(
    Array.from({ length: users }, (_, i) => request('agent-burst', i + 1)),
  );
  for (const result of burst) if (result.status === 'rejected') throw result.reason;
  // Four requests per profile are a deliberate overload probe, separate from team-sized load.
  const overload = await Promise.allSettled(
    Array.from({ length: users * 4 }, (_, i) => request('overload', (i % users) + 1)),
  );
  for (const result of overload) if (result.status === 'rejected') throw result.reason;
  const rate = (
    await db.query(
      'SELECT CEIL(EXTRACT(EPOCH FROM (GREATEST(next_at,blocked_until)-clock_timestamp()))*1000) AS wait_ms FROM hvr_rate_limits WHERE base_id=$1',
      [config.AIRTABLE_BASE_ID],
    )
  ).rows[0];
  assert.ok(Number(rate.wait_ms) <= 1900, 'load rejection must not extend the future queue');
  await new Promise((done) => setTimeout(done, Math.max(0, Number(rate.wait_ms)) + 100));
  assert.equal((await request('post-burst-recovery', 0)).status, 200);
  const metrics = JSON.parse(await readFile(controlFile, 'utf8'));
  assert.ok(
    metrics.userChecks >= samples.filter((sample) => sample.status === 200).length,
    'successful protected requests require fresh upstream user checks',
  );
  const summary = [...new Set(samples.map((s) => s.phase))].map((phase) => {
    const items = samples.filter((s) => s.phase === phase);
    const times = items.map((s) => s.ms).sort((a, b) => a - b);
    return {
      phase,
      requests: items.length,
      ok: items.filter((s) => s.status === 200).length,
      busy: items.filter((s) => s.status === 503).length,
      p50Ms: times[Math.ceil(times.length * 0.5) - 1],
      p95Ms: times[Math.ceil(times.length * 0.95) - 1],
    };
  });
  const operations = Number((await db.query('SELECT count(*) AS n FROM hvr_operations')).rows[0].n);
  assert.equal(operations, 0, 'read-only load may not create business operations');
  Object.assign(report, {
    passed: true,
    phases: summary,
    samples,
    upstream: metrics,
    contextUserRechecks: users,
    contextTaskPages: 0,
    businessOperations: operations,
    normalBurstRequests: users,
    overloadRequests: users * 4,
  });
} catch (error) {
  report.failure = error instanceof Error ? error.message : 'Load rehearsal failed';
  report.samples = samples;
  process.exitCode = 1;
} finally {
  if (server && server.exitCode === null) server.kill();
  if (serverClosed) await serverClosed;
  report.finishedAt = new Date().toISOString();
  await mkdir(resolve('../artifacts/vercel/load'), { recursive: true });
  await writeFile(
    resolve(`../artifacts/vercel/load/${runId}.json`),
    JSON.stringify(report, null, 2),
  );
  await db.end();
  assert.match(schema, /^hvr_load_[a-f0-9]{32}$/);
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
  await rm(controlFile, { force: true });
  console.log(JSON.stringify(report));
}
