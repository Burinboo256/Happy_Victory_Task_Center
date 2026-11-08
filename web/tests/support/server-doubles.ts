// Loaded by NODE_OPTIONS only in the disposable HTTP suite. No application route imports this file.
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { repository } from '../fixtures';
import { schemaFixture } from '../schema-fixture';

if (
  !process.env.HVR_TEST_AGENT_TOKEN ||
  process.env.APP_ENV !== 'development' ||
  !process.env.DATABASE_URL?.includes('hvr_http_') ||
  !process.env.HVR_TEST_CONTROL_FILE
)
  throw new Error('Test upstream doubles require the isolated HTTP suite');
const nativeFetch = globalThis.fetch,
  h = repository();
const controlFile = process.env.HVR_TEST_CONTROL_FILE || '';
const tableIds = {
  [process.env.AIRTABLE_USERS_TABLE || '']: 'users',
  [process.env.AIRTABLE_TASKS_TABLE || '']: 'tasks',
  [process.env.AIRTABLE_UPDATES_TABLE || '']: 'updates',
  [process.env.AIRTABLE_FOLLOWUPS_TABLE || '']: 'followups',
  [process.env.AIRTABLE_NOTIFICATIONS_TABLE || '']: 'notifications',
} as const;
globalThis.fetch = async (input, options) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  );
  if (url.hostname !== 'api.airtable.com') {
    if (!['127.0.0.1', 'localhost'].includes(url.hostname))
      throw new Error('External network disabled in HTTP test suite');
    return nativeFetch(input, options);
  }
  const parts = url.pathname.split('/'),
    table = tableIds[parts[3]],
    id = parts[4];
  const method = options?.method || 'GET';
  const control = JSON.parse(await readFile(controlFile, 'utf8')) as {
    users?: Record<string, Record<string, unknown>>;
    tasks?: Record<string, Record<string, unknown>>;
    taskOwners?: Record<string, string>;
    failUsers?: boolean;
    schemaMismatch?: boolean;
    holdTaskPatch?: string;
  };
  if (url.pathname === `/v0/meta/bases/${process.env.AIRTABLE_BASE_ID}/tables`) {
    if (method !== 'GET') throw new Error('Metadata writes are not permitted in diagnostics');
    if (new Headers(options?.headers).get('Authorization') !== 'Bearer schema-only-test-token')
      return Response.json({ error: 'Schema token rejected' }, { status: 403 });
    const schema = schemaFixture();
    if (control.schemaMismatch)
      schema.field('tasks', 'Agent').options.prefersSingleRecordLink = false;
    return Response.json(schema.value);
  }
  if (!table) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (process.env.HVR_TEST_DIAGNOSTIC_ONLY === '1') {
    if (method !== 'GET' || id || url.searchParams.get('filterByFormula') !== 'FALSE()')
      throw new Error('Diagnostics may not read record contents or mutate records');
    return Response.json({ records: [] });
  }
  if (table === 'users' && control.failUsers)
    return Response.json({ error: 'TEST_PRIVATE_UPSTREAM_MESSAGE' }, { status: 503 });
  if (method === 'GET') {
    if (id) {
      const record = h.tables[table].find((record) => record.id === id);
      const fields = {
        ...record?.fields,
        ...(table === 'users' ? control.users?.[id] : {}),
        ...(table === 'tasks' ? control.tasks?.[id] : {}),
        ...(table === 'tasks' && control.taskOwners?.[id]
          ? { Agent: [control.taskOwners[id]] }
          : {}),
      };
      return record
        ? Response.json({ ...record, fields })
        : Response.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    const records = await h.repo.list(table, url.searchParams.get('filterByFormula') || undefined);
    return Response.json({
      records: records
        .map((record) => ({
          ...record,
          fields: {
            ...record.fields,
            ...(table === 'users' ? control.users?.[record.id] : {}),
            ...(table === 'tasks' ? control.tasks?.[record.id] : {}),
            ...(table === 'tasks' && control.taskOwners?.[record.id]
              ? { Agent: [control.taskOwners[record.id]] }
              : {}),
          },
        }))
        .map((record) => ({
          ...record,
          fields: url.searchParams.has('fields[]')
            ? Object.fromEntries(
                Object.entries(record.fields).filter(([name]) =>
                  url.searchParams.getAll('fields[]').includes(name),
                ),
              )
            : record.fields,
        })),
    });
  }
  const body = JSON.parse(String(options?.body));
  if (method !== 'PATCH') throw new Error('Unexpected test write method');
  if (id) {
    if (table === 'tasks' && control.holdTaskPatch === id) {
      await writeFile(controlFile + '.held', id);
      const deadline = Date.now() + 15000;
      while ((await readFile(controlFile + '.release', 'utf8').catch(() => '')) !== id) {
        if (Date.now() > deadline) throw new Error('Isolated test patch gate timed out');
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    return Response.json(await h.repo.patch(table, id, body.fields));
  }
  const key = body.performUpsert.fieldsToMergeOn[0],
    fields = body.records[0].fields;
  const result = await h.repo.upsert(table, key, fields);
  const record = h.tables[table].find((record) => record.id === result.id);
  if (!record) throw new Error('Missing test record');
  if (table === 'tasks') {
    record.fields['Last Update'] = randomUUID();
    record.fields['Created At'] ||= new Date().toISOString();
    record.fields['Task ID'] ||= 'HVR-TEST-' + h.tables.tasks.length;
    if (fields['Task Title'] === 'TEST_UNCERTAIN')
      throw new Error('Simulated network failure after write');
  }
  return Response.json({ records: [record] });
};
