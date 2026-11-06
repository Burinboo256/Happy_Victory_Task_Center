// Bounded, opt-in read probe of the isolated test Base. Not Google/HTTP/load acceptance.
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { localConfig } from './environment';
import { getPool } from '../src/server/db';
import { runtimeState } from '../src/server/runtime';
import { AirtableClient } from '../src/server/airtable/client';
import { userDto } from '../src/server/airtable/dto';
import { bootstrap } from '../src/server/services/reads';
import { AppError } from '../src/server/errors';

const { values } = parseArgs({ options: { 'confirm-test-base': { type: 'string' } } });
const config = localConfig();
const testBase = 'appoQzvQwGShlq4OJ';
const database = new URL(config.DATABASE_URL);
if (
  values['confirm-test-base'] !== testBase ||
  config.AIRTABLE_BASE_ID !== testBase ||
  config.APP_ENV !== 'development' ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) ||
  config.JOBS_ENABLED ||
  config.ENABLE_EMAIL_NOTIFICATIONS ||
  config.ENABLE_LINE_NOTIFICATIONS ||
  process.env.NODE_OPTIONS?.includes('--import')
)
  throw new Error('Explicit local test Base confirmation and disabled jobs/notifications required');

const db = getPool(config);
const requestBudget = 30;
const deadline = Date.now() + 90000;
const runId = randomUUID();
const samples: { role: string; scope: string; ms: number; upstreamCalls: number; tasks: number }[] =
  [];
const upstream: { table: string; status: number; ms: number }[] = [];
const report: Record<string, unknown> = {
  runId,
  startedAt: new Date().toISOString(),
  base: testBase,
  requestBudget,
  scope:
    'local service reads + real Airtable/PostgreSQL; no Google session, HTTP browser, or load acceptance',
  passed: false,
};
let attempts = 0;
const transport: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const table = url.pathname.split('/')[3];
  if (
    (init?.method || 'GET') !== 'GET' ||
    url.origin !== 'https://api.airtable.com' ||
    !url.pathname.startsWith(`/v0/${testBase}/`) ||
    ![config.AIRTABLE_USERS_TABLE, config.AIRTABLE_TASKS_TABLE].includes(table)
  )
    throw new AppError(503, 'PROBE_READ_ONLY', 'Probe may only read test Users / Tasks');
  if (attempts >= requestBudget || Date.now() >= deadline)
    throw new AppError(503, 'PROBE_BUDGET', 'Probe request/time budget exhausted');
  attempts++;
  const start = performance.now();
  const response = await fetch(input, init);
  // Include body transfer in the upstream timing. Values are never persisted or printed.
  await response.clone().arrayBuffer();
  upstream.push({
    table: table === config.AIRTABLE_USERS_TABLE ? 'users' : 'tasks',
    status: response.status,
    ms: Math.round(performance.now() - start),
  });
  return response;
};
const repo = new AirtableClient(config, db, transport);
try {
  const state = await runtimeState(db, config);
  if (state.jobs) throw new AppError(503, 'JOBS_ACTIVE', 'Disable development jobs before probing');
  const actors = await repo.list('users', undefined, ['Role', 'Active', 'Google Subject']);
  const selected = ['Agent', 'Secretary'].map((role) => {
    const actor = actors.find(
      (r) =>
        r.fields.Role === role &&
        r.fields.Active === true &&
        typeof r.fields['Google Subject'] === 'string' &&
        r.fields['Google Subject'],
    );
    if (!actor)
      throw new AppError(503, 'PROBE_ACTORS', 'Prepared active bound Agent / Secretary required');
    return { id: actor.id, role };
  });
  // Every measured service read starts with a fresh Users GET, as the HTTP auth path does.
  // It does not create a session or claim that these service reads performed Google Login.
  for (let round = 0; round < 3; round++) {
    for (const actor of selected) {
      for (const scope of ['full', 'context'] as const) {
        const start = performance.now(),
          before = attempts;
        const user = userDto(await repo.get('users', actor.id));
        if (!user.active || !user.sub || user.role !== actor.role)
          throw new AppError(403, 'PROBE_ACTOR_CHANGED', 'Selected actor changed during probe');
        const data = await bootstrap(repo, user, scope);
        if (
          scope === 'full' &&
          user.role === 'Agent' &&
          data.tasks.some((t) => t.agentId !== user.id)
        )
          throw new AppError(503, 'PROBE_OWNERSHIP', 'Unexpected owner in service response');
        if (scope === 'context' && (data.tasksIncluded || data.tasks.length))
          throw new AppError(503, 'PROBE_CONTEXT', 'Context unexpectedly returned task summaries');
        samples.push({
          role: actor.role,
          scope,
          ms: Math.round(performance.now() - start),
          upstreamCalls: attempts - before,
          tasks: data.tasks.length,
        });
      }
    }
  }
  report.passed = true;
} catch (error) {
  // Do not print error.message / cause / stack; upstream URLs or values may be sensitive.
  report.errorCode = error instanceof AppError ? error.code : 'PROBE_FAILED';
  process.exitCode = 1;
} finally {
  const groups = [...new Set(samples.map((s) => `${s.role}:${s.scope}`))].map((key) => {
    const rows = samples.filter((s) => `${s.role}:${s.scope}` === key);
    const times = rows.map((s) => s.ms).sort((a, b) => a - b);
    return {
      key,
      samples: rows.length,
      minMs: times[0],
      medianMs: times[Math.floor(times.length / 2)],
      maxMs: times.at(-1),
      upstreamCalls: rows.map((s) => s.upstreamCalls),
      taskCounts: rows.map((s) => s.tasks),
    };
  });
  Object.assign(report, {
    finishedAt: new Date().toISOString(),
    attempts,
    mutationRequests: 0,
    groups,
    samples,
    upstream,
  });
  await db.end();
  await mkdir(resolve('../artifacts/vercel/probes'), { recursive: true });
  await writeFile(
    resolve(`../artifacts/vercel/probes/${runId}.json`),
    JSON.stringify(report, null, 2),
    { flag: 'wx' },
  );
  console.log(JSON.stringify(report));
}
