import test from 'node:test';
import assert from 'node:assert/strict';
import type { QueryResult } from 'pg';
import type { Sql } from '../src/server/db';
import { AirtableClient } from '../src/server/airtable/client';
import { inspectSchema } from '../src/server/airtable/schema';
import { config } from './fixtures';
import { schemaFixture } from './schema-fixture';

test('schema contract accepts the five documented tables and equivalent formula formatting', () => {
  const f = schemaFixture();
  assert.deepEqual(inspectSchema(f.value, config), []);
  // Live metadata for All editable fields uses an empty list; partial lists still fail below.
  f.field('tasks', 'Last Update').options.referencedFieldIds = [];
  assert.deepEqual(inspectSchema(f.value, config), []);
  f.field('users', 'Record ID').options.formula = 'record_id ( )';
  f.field('tasks', 'Task ID').options.formula =
    `'HVR-' & right('00000' & {${f.field('tasks', 'Sequence').id}}, 5)`;
  assert.deepEqual(inspectSchema(f.value, config), []);
});

test('schema drift reports only known contract names and categorical mismatch codes', () => {
  const f = schemaFixture();
  f.field('users', 'Role').options.choices = [{ name: 'Private custom role' }];
  f.field('tasks', 'Due Date').type = 'singleLineText';
  f.field('tasks', 'Agent').options.linkedTableId = config.AIRTABLE_TASKS_TABLE;
  f.field('updates', 'Task').options.prefersSingleRecordLink = false;
  f.field('followups', 'Task Record ID').options.fieldIdInLinkedTable = f.field(
    'tasks',
    'Task Title',
  ).id;
  f.field('tasks', 'Record ID').options.formula = '"PRIVATE_SCHEMA_LITERAL"';
  f.field('tasks', 'Last Update').options.referencedFieldIds = [f.field('tasks', 'Task Title').id];
  f.tables.notifications.primaryFieldId = f.field('notifications', 'Task').id;
  f.tables.users.fields = f.tables.users.fields.filter((field) => field.name !== 'Email');
  const issues = inspectSchema(f.value, config),
    codes = issues.map((issue) => issue.code);
  for (const expected of [
    'SELECT_OPTIONS',
    'FIELD_TYPE',
    'LINK_TARGET_OR_CARDINALITY',
    'LOOKUP_SOURCE',
    'FORMULA',
    'LAST_MODIFIED_SCOPE_OR_TIME',
    'PRIMARY_FIELD',
    'FIELD_MISSING_OR_DUPLICATE',
  ])
    assert.ok(codes.includes(expected), expected);
  assert.equal(JSON.stringify(issues).includes('PRIVATE_SCHEMA_LITERAL'), false);
  assert.equal(JSON.stringify(issues).includes('Private custom role'), false);
});

test('mapping, broken computed fields and incomplete modification tracking cannot pass readiness', () => {
  const f = schemaFixture();
  assert.ok(
    inspectSchema(f.value, { ...config, AIRTABLE_TASKS_TABLE: 'tbl99999999999999' }).some(
      (issue) => issue.code === 'TABLE_MAPPING',
    ),
  );
  f.field('tasks', 'Last Update').options.result = { type: 'date' };
  f.field('tasks', 'Agent Record ID').options.isValid = false;
  assert.ok(
    inspectSchema(f.value, config).some((issue) => issue.code === 'LAST_MODIFIED_SCOPE_OR_TIME'),
  );
  assert.ok(inspectSchema(f.value, config).some((issue) => issue.code === 'LOOKUP_SOURCE'));
  assert.throws(() => inspectSchema({ tables: null }, config), /metadata is invalid/);
});

test('schema fetch uses a separate read-only token, shared pacing and no record mutation', async () => {
  const sql: string[] = [];
  const db = {
    async query(query: string) {
      sql.push(query);
      return { rows: [{ wait_ms: '230' }] } as QueryResult;
    },
  } as Sql;
  let calls = 0;
  const client = new AirtableClient(config, db, async (input, options) => {
    calls++;
    assert.equal(
      String(input),
      `https://api.airtable.com/v0/meta/bases/${config.AIRTABLE_BASE_ID}/tables`,
    );
    assert.equal(options?.method, 'GET');
    assert.equal(options?.cache, 'no-store');
    assert.equal(options?.redirect, 'error');
    assert.equal(
      new Headers(options?.headers).get('Authorization'),
      'Bearer schema-only-test-token',
    );
    return Response.json(schemaFixture().value);
  });
  await assert.rejects(client.schema(''), /token is required/);
  assert.equal(calls, 0);
  assert.deepEqual(inspectSchema(await client.schema('schema-only-test-token'), config), []);
  assert.equal(calls, 1);
  assert.equal(sql.length, 1);
});
