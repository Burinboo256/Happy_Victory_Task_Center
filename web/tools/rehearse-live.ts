// Opt-in service/CLI acceptance against the isolated local test Base. No Google login bypass.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { PoolClient } from 'pg';
import { localConfig } from './environment';
import { getPool } from '../src/server/db';
import { AirtableClient, formulaValue, type Table } from '../src/server/airtable/client';
import { taskDto, userDto } from '../src/server/airtable/dto';
import { Journal } from '../src/server/operations/journal';
import { OperationRecovery } from '../src/server/operations/recovery';
import { requireTaskReady } from '../src/server/operations/task-ready';
import { mutate, validateMutation, type Action } from '../src/server/services/mutations';
import { bootstrap, detail } from '../src/server/services/reads';
import { requireWrites, verifyInstance } from '../src/server/runtime';
import { AppError } from '../src/server/errors';
import { todayBangkok, type User } from '../src/domain/model';

const config = localConfig();
const { values } = parseArgs({
  options: {
    'confirm-test-base': { type: 'string' },
    'run-id': { type: 'string' },
    'crash-request-id': { type: 'string' },
  },
});
// Intentionally pinned: this tool must never become a general production mutation command.
const testBase = 'appoQzvQwGShlq4OJ';
const localDatabase = new URL(config.DATABASE_URL);
if (
  config.APP_ENV !== 'development' ||
  config.AIRTABLE_BASE_ID !== testBase ||
  values['confirm-test-base'] !== testBase ||
  !['localhost', '127.0.0.1', '[::1]'].includes(localDatabase.hostname) ||
  config.JOBS_ENABLED ||
  config.ENABLE_EMAIL_NOTIFICATIONS ||
  config.ENABLE_LINE_NOTIFICATIONS
)
  throw new Error('Local test Base confirmation and disabled notification flags are required.');

const db = getPool(config);
const runId = values['run-id'] || randomUUID();
if (!/^[a-f0-9-]{36}$/.test(runId)) throw new Error('Invalid run ID');
const reportPath = resolve('../artifacts/vercel/live-recovery-' + runId + '.json');
const report: {
  runId: string;
  base: string;
  scope: string;
  phase: string;
  passed: boolean;
  operations: { action: string; id: string; state: string; confirmed?: string[] }[];
  checks: Record<string, boolean>;
  crashChild?: { pid: number | undefined; exitCode: number | null; closedAt: string };
} = {
  runId,
  base: testBase,
  scope: 'real Airtable and PostgreSQL; synthetic service actors, not Google/HTTP acceptance',
  phase: 'preflight',
  passed: false,
  operations: [],
  checks: {},
};
let reportInitialized = false;
const persist = async () => {
  await mkdir(resolve('../artifacts/vercel'), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2), {
    flag: reportInitialized ? 'w' : 'wx',
  });
  reportInitialized = true;
};
const tables: Record<Table, string> = {
  users: config.AIRTABLE_USERS_TABLE,
  tasks: config.AIRTABLE_TASKS_TABLE,
  updates: config.AIRTABLE_UPDATES_TABLE,
  followups: config.AIRTABLE_FOLLOWUPS_TABLE,
  notifications: config.AIRTABLE_NOTIFICATIONS_TABLE,
};
type Fault = { table: Table; field: string; crash?: boolean };
let fault: Fault | undefined;
let writes = 0;
let faultsApplied = 0;
const transport: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  assert.equal(url.origin, 'https://api.airtable.com');
  assert.ok(url.pathname.startsWith('/v0/' + testBase + '/'));
  const method = init?.method || 'GET';
  if (method !== 'GET') writes++;
  const response = await fetch(input, init);
  if (
    fault &&
    method === 'PATCH' &&
    response.ok &&
    url.pathname.split('/')[3] === tables[fault.table]
  ) {
    const body = JSON.parse(String(init?.body));
    const fields = body.fields || body.records?.[0]?.fields || {};
    if (Object.hasOwn(fields, fault.field)) {
      const crash = fault.crash;
      fault = undefined;
      // Consume the actual server response before simulating loss/crash, never invent its success.
      await response.arrayBuffer();
      faultsApplied++;
      if (crash) process.exit(86);
      throw new TypeError('Injected lost acknowledgement after real server response');
    }
  }
  return response;
};
const repo = new AirtableClient(config, db, transport);
const journal = new Journal(db, config);
async function actor(userId: string, role: User['role']) {
  const rows = await repo.list('users', `{User ID}=${formulaValue(userId)}`);
  assert.equal(rows.length, 1);
  const user = userDto(rows[0]);
  assert.equal(user.role, role);
  assert.equal(user.active, true);
  assert.ok(user.email.endsWith('@example.invalid'));
  assert.ok(user.name.startsWith('[LOCAL TEST]'));
  assert.equal(user.sub, '');
  return user;
}
async function switchWrites(enabled: boolean) {
  await verifyInstance(db, config);
  const result = await db.query(
    'UPDATE hvr_runtime SET task_writes=$2 WHERE environment=$1 AND NOT jobs RETURNING task_writes',
    [config.APP_ENV, enabled],
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].task_writes, enabled);
}
async function execute(user: User, key: string, action: Action, input: unknown) {
  await requireWrites(db, config);
  const data = validateMutation(action, input, user);
  if (action !== 'create' && 'id' in data) {
    await requireTaskReady(db, config, repo, data.id);
  }
  return journal.execute(
    user.id,
    key,
    action,
    data,
    action === 'create' ? `create:${user.id}:${key}` : 'task:' + ('id' in data ? data.id : ''),
    (steps) => mutate(repo, user, action, data, steps),
  );
}
async function recover(id: string, action: 'reconcile' | 'mark-stopped' = 'reconcile') {
  const before = writes;
  const result = await new OperationRecovery(db, config, repo).run({
    id,
    action,
    confirmNoInflight: id,
    operator: 'live-rehearsal',
    evidence: 'LOCAL/rehearsal/' + runId,
  });
  assert.equal(writes, before, 'Recovery must not write to Airtable');
  return result;
}
async function lostAcknowledgement(user: User, action: Action, payload: unknown, target: Fault) {
  report.phase = 'lost-ack-' + action;
  await persist();
  const key = randomUUID();
  fault = target;
  const applied = faultsApplied;
  const first = await execute(user, key, action, payload);
  report.operations.push({ action, id: first.operationId, state: first.state });
  await persist();
  assert.equal(faultsApplied, applied + 1);
  assert.equal(first.state, 'review');
  const before = writes;
  assert.equal((await execute(user, key, action, payload)).state, 'review');
  assert.equal(writes, before, 'Review cannot retry a write');
  await assert.rejects(
    recover(first.operationId),
    (error: unknown) => error instanceof AppError && error.code === 'RECOVERY_REQUIRES_PAUSE',
  );
  await switchWrites(false);
  const stopped = await db.query(
    "SELECT count(*)::int AS count FROM hvr_operations WHERE environment=$1 AND state='running'",
    [config.APP_ENV],
  );
  assert.equal(stopped.rows[0].count, 0);
  const result = await recover(first.operationId);
  assert.equal(result.state, 'pending');
  assert.equal(result.unresolved.length, 0);
  await switchWrites(true);
  const resumed = await execute(user, key, action, payload);
  assert.equal(resumed.state, 'completed');
  const settledWrites = writes;
  assert.deepEqual(await execute(user, key, action, payload), resumed);
  assert.equal(writes, settledWrites, 'Completed replay must not call Airtable writes');
  const entry = report.operations.at(-1);
  assert.ok(entry);
  Object.assign(entry, { state: resumed.state, confirmed: result.confirmed });
  report.checks[action + '-lost-ack-recovery-replay'] = true;
  await persist();
  return resumed;
}
const createData = (suffix: string) => ({
  title: '[LOCAL TEST] Recovery rehearsal ' + runId + ' ' + suffix,
  description: 'Synthetic recovery acceptance; no customer data.',
  dueDate: todayBangkok(),
  category: 'วันเกิดตัวแทนและลูกค้า',
  priority: 'Normal',
});

let started = false;
let guard: PoolClient | undefined;
try {
  await verifyInstance(db, config);
  const flags = (
    await db.query('SELECT task_writes,jobs FROM hvr_runtime WHERE environment=$1', [
      config.APP_ENV,
    ])
  ).rows[0];
  assert.equal(flags?.jobs, false);
  await requireWrites(db, config);
  const agentA = await actor('LOCAL-AGENT-A', 'Agent');
  if (values['crash-request-id']) {
    assert.match(values['crash-request-id'], /^[a-f0-9-]{36}$/);
    fault = { table: 'tasks', field: 'Request Key', crash: true };
    await execute(agentA, values['crash-request-id'], 'create', createData('process-exit'));
    throw new Error('Crash injection did not run');
  }
  guard = await db.connect();
  assert.equal(
    (await guard.query('SELECT pg_try_advisory_lock(817204322) AS acquired')).rows[0].acquired,
    true,
  );
  const unfinished = await db.query(
    "SELECT count(*)::int AS count FROM hvr_operations WHERE environment=$1 AND state IN ('pending','running','review')",
    [config.APP_ENV],
  );
  assert.equal(unfinished.rows[0].count, 0, 'Resolve existing operations before another rehearsal');
  const agentB = await actor('LOCAL-AGENT-B', 'Agent');
  const secretary = await actor('LOCAL-SECRETARY', 'Secretary');
  await persist();
  started = true;
  const created = await lostAcknowledgement(agentA, 'create', createData('lost-ack'), {
    table: 'tasks',
    field: 'Request Key',
  });
  assert.ok(created.result);
  const taskId = created.result.id;
  const requestRows = await repo.list(
    'tasks',
    `{Request Key}=${formulaValue('web:' + created.operationId)}`,
  );
  assert.equal(requestRows.length, 1);
  await lostAcknowledgement(
    secretary,
    'comment',
    { id: taskId, message: '[LOCAL TEST] Internal recovery comment', visible: false },
    { table: 'updates', field: 'Operation Key' },
  );
  await lostAcknowledgement(
    secretary,
    'followup',
    { id: taskId, date: todayBangkok(), notes: '[LOCAL TEST] Recovery follow-up' },
    { table: 'tasks', field: 'Next Follow-up' },
  );
  const pending = await repo.list('followups', `{Task Record ID}=${formulaValue(taskId)}`);
  assert.equal(pending.length, 1);
  await lostAcknowledgement(
    secretary,
    'resolveFollowup',
    {
      id: taskId,
      followupId: pending[0].id,
      status: 'Done',
      notes: '[LOCAL TEST] Resolved after recovery',
    },
    { table: 'followups', field: 'Completed At' },
  );
  const beforeStatus = taskDto(await repo.get('tasks', taskId));
  await lostAcknowledgement(
    secretary,
    'status',
    {
      id: taskId,
      version: beforeStatus.version,
      status: 'Completed',
      message: '[LOCAL TEST] Completed after recovery',
    },
    { table: 'tasks', field: 'Completed At' },
  );
  const completed = taskDto(await repo.get('tasks', taskId));
  assert.ok(completed.completedAt);
  const repeated = await execute(secretary, randomUUID(), 'status', {
    id: taskId,
    version: completed.version,
    status: 'Completed',
  });
  assert.equal(repeated.state, 'completed');
  assert.equal(taskDto(await repo.get('tasks', taskId)).completedAt, completed.completedAt);
  report.operations.push({
    action: 'repeat-completed',
    id: repeated.operationId,
    state: repeated.state,
  });
  report.checks['completed-timestamp-preserved'] = true;
  const a = await detail(repo, agentA, taskId);
  assert.equal(
    a.updates.some((update) => update.type === 'Comment'),
    false,
  );
  assert.equal(a.followups.length, 0);
  await assert.rejects(
    detail(repo, agentB, taskId),
    (error: unknown) => error instanceof AppError && error.code === 'FORBIDDEN',
  );
  assert.equal(
    (await bootstrap(repo, agentB)).tasks.some((task) => task.id === taskId),
    false,
  );
  const full = await detail(repo, secretary, taskId);
  assert.equal(full.updates.length, 6);
  assert.equal(full.followups.length, 1);
  assert.equal(full.followups[0].status, 'Done');
  assert.equal(full.task.followupDate, '');
  report.checks['real-data-role-filtering-and-no-duplicate-records'] = true;

  // An actual child process exits after Airtable acknowledges, before the step can finish in PG.
  report.phase = 'crash-child';
  await persist();
  const crashKey = randomUUID();
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      'tools/rehearse-live.ts',
      '--confirm-test-base=' + testBase,
      '--run-id=' + runId,
      '--crash-request-id=' + crashKey,
    ],
    { stdio: 'ignore', windowsHide: true },
  );
  const exitCode = await new Promise<number | null>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });
  report.crashChild = { pid: child.pid, exitCode, closedAt: new Date().toISOString() };
  await persist();
  assert.equal(exitCode, 86, 'Child process must have terminated after the real response');
  const crashRow = (
    await db.query(
      'SELECT id,state,EXTRACT(EPOCH FROM (clock_timestamp()-updated_at)) AS age FROM hvr_operations WHERE environment=$1 AND user_id=$2 AND request_id=$3',
      [config.APP_ENV, agentA.id, crashKey],
    )
  ).rows[0];
  assert.equal(crashRow?.state, 'running');
  report.operations.push({ action: 'process-exit-create', id: crashRow.id, state: 'running' });
  await switchWrites(false);
  await assert.rejects(
    recover(crashRow.id, 'mark-stopped'),
    (error: unknown) => error instanceof AppError && error.code === 'RECOVERY_NOT_STOPPED',
  );
  report.phase = 'waiting-minimum-stopped-age';
  await persist();
  console.log(
    'Crash child is terminal (exit 86); waiting for the real 120-second recovery minimum.',
  );
  await new Promise((resolveWait) =>
    setTimeout(resolveWait, Math.max(0, 125000 - Number(crashRow.age) * 1000)),
  );
  assert.equal((await recover(crashRow.id, 'mark-stopped')).state, 'review');
  const reconciled = await recover(crashRow.id);
  assert.equal(reconciled.state, 'pending');
  assert.deepEqual(reconciled.confirmed, ['task']);
  await switchWrites(true);
  const finishedCrash = await execute(agentA, crashKey, 'create', createData('process-exit'));
  assert.equal(finishedCrash.state, 'completed');
  const crashEntry = report.operations.at(-1);
  assert.ok(crashEntry);
  Object.assign(crashEntry, { state: 'completed', confirmed: reconciled.confirmed });
  assert.equal(
    (await repo.list('tasks', `{Request Key}=${formulaValue('web:' + crashRow.id)}`)).length,
    1,
  );
  assert.equal(
    (await repo.list('updates', `{Operation Key}=${formulaValue('web:' + crashRow.id + ':audit')}`))
      .length,
    1,
  );
  report.checks['terminal-process-running-review-reconcile-retry'] = true;
  const ids = report.operations.map((op) => op.id);
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS count FROM hvr_resources WHERE environment=$1 AND operation_id=ANY($2::uuid[])',
        [config.APP_ENV, ids],
      )
    ).rows[0].count,
    0,
  );
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS count FROM hvr_recovery_events WHERE environment=$1 AND operation_id=ANY($2::uuid[])',
        [config.APP_ENV, ids],
      )
    ).rows[0].count,
    7,
  );
  report.checks['no-reservations-and-seven-audited-recovery-events'] = true;
  report.phase = 'completed';
  report.passed = true;
  await persist();
  console.log(JSON.stringify({ passed: true, report: reportPath, checks: report.checks }, null, 2));
} catch (error) {
  if (started) {
    await switchWrites(false).catch(() => undefined);
    await persist().catch(() => undefined);
  }
  console.error(error instanceof AppError ? error.code : 'LIVE_REHEARSAL_FAILED');
  console.error('Inspect the rehearsal report and journal; do not restart an unfinished run.');
  process.exitCode = 1;
} finally {
  if (guard) {
    await guard.query('SELECT pg_advisory_unlock(817204322)');
    guard.release();
  }
  await db.end();
}
