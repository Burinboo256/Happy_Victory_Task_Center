// Opt-in synthetic upstream for test:load only; never imported by application code.
import { readFileSync, writeFileSync } from 'node:fs';

const database = new URL(process.env.DATABASE_URL || 'file:///');
if (
  process.env.APP_ENV !== 'development' ||
  process.env.APP_ORIGIN !== 'http://127.0.0.1:4182' ||
  process.env.AIRTABLE_BASE_ID !== 'app00000000000000' ||
  process.env.AIRTABLE_TOKEN !== 'test-only-token-never-live' ||
  !/test/i.test(database.pathname) ||
  !/^-c search_path=hvr_load_[a-f0-9]{32}$/.test(database.searchParams.get('options') || '') ||
  !process.env.HVR_LOAD_CONTROL_FILE
)
  throw new Error('Load upstream requires a disposable test schema and synthetic credentials');
const controlFile = process.env.HVR_LOAD_CONTROL_FILE;
const control = JSON.parse(readFileSync(controlFile, 'utf8'));
if (
  !Number.isInteger(control.users) ||
  control.users < 1 ||
  control.users > 20 ||
  !Number.isInteger(control.tasks) ||
  control.tasks < 1 ||
  control.tasks > 5000 ||
  !Number.isInteger(control.delayMs) ||
  control.delayMs < 0 ||
  control.delayMs > 500
)
  throw new Error('Invalid bounded load scenario');
const rid = (n) => `rec${String(n).padStart(14, '0')}`;
const users = Array.from({ length: control.users + 1 }, (_, i) => ({
  id: rid(i + 1),
  fields: {
    'Full Name': i === 0 ? 'Load Secretary' : `Load Agent ${i}`,
    Email: `load-${i}@example.invalid`,
    Role: i === 0 ? 'Secretary' : 'Agent',
    Active: true,
    'Google Subject': `load-${i}`,
  },
}));
const tasks = Array.from({ length: control.tasks }, (_, i) => ({
  id: rid(1000 + i),
  fields: {
    'Task ID': `LOAD-${i + 1}`,
    'Task Title': `งานสมมติ ${i + 1}`,
    Description: 'ข้อมูลสมมติสำหรับวัด HTTP บนเครื่อง',
    Agent: [rid(2 + (i % control.users))],
    Status: 'New',
    Priority: 'Normal',
    Category: 'งานทั่วไป',
    'Due Date': '2026-11-06',
    'Created At': '2026-11-06T01:00:00Z',
    'Last Update': '2026-11-06T01:00:00Z',
  },
}));
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== 'https://api.airtable.com') {
    if (!['127.0.0.1', 'localhost'].includes(url.hostname))
      throw new Error('External network disabled in synthetic load test');
    return nativeFetch(input, init);
  }
  if ((init?.method || 'GET') !== 'GET') throw new Error('Load test upstream is read-only');
  const [, version, base, table, id] = url.pathname.split('/');
  if (version !== 'v0' || base !== process.env.AIRTABLE_BASE_ID)
    throw new Error('Unexpected load test Base');
  const kind =
    table === process.env.AIRTABLE_USERS_TABLE
      ? 'users'
      : table === process.env.AIRTABLE_TASKS_TABLE
        ? 'tasks'
        : undefined;
  if (!kind) throw new Error('Unexpected load test table');
  const stats = JSON.parse(readFileSync(controlFile, 'utf8'));
  const metric = kind === 'users' && id ? 'userChecks' : `${kind}Pages`;
  stats[metric] = (stats[metric] || 0) + 1;
  stats.upstreamCalls = (stats.upstreamCalls || 0) + 1;
  writeFileSync(controlFile, JSON.stringify(stats));
  if (control.delayMs) await new Promise((resolve) => setTimeout(resolve, control.delayMs));
  let rows = kind === 'users' ? users : tasks;
  if (id) {
    const row = rows.find((r) => r.id === id);
    return row ? Response.json(row) : Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  const formula = url.searchParams.get('filterByFormula');
  if (formula) {
    const match = /^\{Agent Record ID\}="(rec\d{14})"$/.exec(formula);
    if (kind !== 'tasks' || !match) throw new Error('Unsupported load test formula');
    rows = rows.filter((row) => row.fields.Agent.includes(match[1]));
  }
  const start = Number(url.searchParams.get('offset') || '0');
  if (!Number.isInteger(start) || start < 0) throw new Error('Invalid load test pagination');
  const fields = url.searchParams.getAll('fields[]');
  return Response.json({
    records: rows.slice(start, start + 100).map((row) => ({
      id: row.id,
      fields: fields.length
        ? Object.fromEntries(Object.entries(row.fields).filter(([key]) => fields.includes(key)))
        : row.fields,
    })),
    ...(start + 100 < rows.length ? { offset: String(start + 100) } : {}),
  });
};
