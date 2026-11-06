import test from 'node:test';
import assert from 'node:assert/strict';
import { AirtableClient } from '../src/server/airtable/client';
import type { Sql } from '../src/server/db';
import type { QueryResult } from 'pg';
import { config, rid, repository } from './fixtures';
import { bootstrap } from '../src/server/services/reads';
import { UncertainWrite } from '../src/server/errors';

function limiter() {
  const statements: string[] = [];
  const db = {
    async query(sql: string) {
      statements.push(sql);
      return { rows: [{ wait_ms: '230' }] } as QueryResult;
    },
  } as Sql;
  return { db, statements };
}
test('Airtable pagination encodes offset and refuses repeated pages', async () => {
  const { db } = limiter();
  let n = 0;
  const repo = new AirtableClient(config, db, async (input, options) => {
    assert.equal(options?.cache, 'no-store');
    const url = new URL(String(input));
    if (n++ === 0)
      return Response.json({ records: [{ id: rid(11), fields: {} }], offset: 'a/b+c' });
    assert.equal(url.searchParams.get('offset'), 'a/b+c');
    return Response.json({ records: [], offset: 'a/b+c' });
  });
  await assert.rejects(repo.list('tasks'), /โหลดข้อมูลยังไม่สำเร็จ/);
});
test('429 persists a shared cooldown and redacts upstream contents', async () => {
  const { db, statements } = limiter();
  const repo = new AirtableClient(
    config,
    db,
    async () => new Response('private-token-and-details', { status: 429 }),
  );
  await assert.rejects(
    repo.list('users'),
    (error) => error instanceof Error && !error.message.includes('private-token'),
  );
  assert.ok(statements.some((s) => s.includes('blocked_until') && s.includes('30 seconds')));
});
test('ambiguous mutations are classified separately from reads and are never retried in place', async () => {
  const { db } = limiter();
  let calls = 0;
  const repo = new AirtableClient(config, db, async () => {
    calls++;
    throw new Error('secret-upstream');
  });
  await assert.rejects(repo.patch('tasks', rid(11), { Status: 'Completed' }), UncertainWrite);
  assert.equal(calls, 1);
  await assert.rejects(
    repo.get('tasks', rid(11)),
    (error) =>
      error instanceof Error &&
      !(error instanceof UncertainWrite) &&
      !error.message.includes('secret'),
  );
});

test('250-task bootstrap follows every page with field projection; compose context never lists tasks', async () => {
  const { db } = limiter(),
    h = repository();
  const original = h.tables.tasks[0];
  h.tables.tasks = Array.from({ length: 250 }, (_, n) => ({
    id: rid(2000 + n),
    fields: {
      ...original.fields,
      Description: 'Searchable task details',
      Attachments: [{ url: 'https://example.test/' + 'x'.repeat(3000) }],
      'Reference URL': 'https://example.test/' + 'r'.repeat(1000),
    },
  }));
  const tables = {
    [config.AIRTABLE_TASKS_TABLE]: 'tasks',
    [config.AIRTABLE_USERS_TABLE]: 'users',
  } as const;
  const requests: { table: string; bytes: number }[] = [];
  const repo = new AirtableClient(config, db, async (input) => {
    const url = new URL(String(input)),
      table = tables[url.pathname.split('/')[3]];
    assert.ok(table);
    const fields = url.searchParams.getAll('fields[]');
    assert.ok(fields.includes(table === 'tasks' ? 'Description' : 'Active'));
    assert.equal(fields.includes('Attachments'), false);
    assert.equal(fields.includes('Google Subject'), false);
    const all = await h.repo.list(table, undefined, fields);
    const start = Number(url.searchParams.get('offset') || 0),
      records = all.slice(start, start + 100);
    const body = { records, ...(start + 100 < all.length ? { offset: String(start + 100) } : {}) };
    requests.push({ table, bytes: Buffer.byteLength(JSON.stringify(body)) });
    return Response.json(body);
  });
  const full = await bootstrap(repo, h.secretary);
  assert.equal(full.tasks.length, 250);
  assert.equal(full.tasks[249].description, 'Searchable task details');
  assert.equal(full.tasksIncluded, true);
  assert.deepEqual(
    requests.map((r) => r.table),
    ['tasks', 'tasks', 'tasks', 'users'],
  );
  const projectedBytes = requests
    .filter((r) => r.table === 'tasks')
    .reduce((sum, r) => sum + r.bytes, 0);
  assert.ok(projectedBytes < Buffer.byteLength(JSON.stringify(h.tables.tasks)) / 4);
  requests.length = 0;
  await bootstrap(repo, h.secretary, 'context');
  assert.deepEqual(
    requests.map((r) => r.table),
    ['users'],
  );
  requests.length = 0;
  await bootstrap(repo, h.agent, 'context');
  assert.equal(requests.length, 0);
});

test('malformed Airtable record envelopes fail closed and malformed write acknowledgements require review', async () => {
  const { db } = limiter();
  for (const body of [
    { records: [{ id: rid(11), fields: null }] },
    { records: [], offset: 100 },
    { records: [{ id: 'bad', fields: {} }] },
    null,
  ]) {
    const repo = new AirtableClient(config, db, async () => Response.json(body));
    await assert.rejects(repo.list('tasks'), /บริการข้อมูลตอบกลับไม่ถูกต้อง/);
  }
  const repo = new AirtableClient(config, db, async () =>
    Response.json({ id: rid(12), fields: {} }),
  );
  await assert.rejects(repo.get('tasks', rid(11)), /บริการข้อมูลตอบกลับไม่ถูกต้อง/);
  await assert.rejects(repo.patch('tasks', rid(11), { Status: 'Completed' }), UncertainWrite);
  await assert.rejects(
    repo.upsert('tasks', 'Request Key', { 'Request Key': 'test' }),
    UncertainWrite,
  );
});
