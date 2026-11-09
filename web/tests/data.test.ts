import test from 'node:test';
import assert from 'node:assert/strict';
import { repository, rid } from './fixtures';
import { taskDto, taskSummaryDto, followupDto, updateDto, userDto } from '../src/server/airtable/dto';
import { day, timestamp } from '../src/server/airtable/values';
import { bootstrap } from '../src/server/services/reads';

test('invalid Airtable dates and timestamps are rejected without leaking values or inventing a date', () => {
  for (const value of ['2026-02-30', '2026-13-01', 'not-a-day', {}, 0])
    assert.throws(() => day(value), /ข้อมูลบางรายการไม่ถูกต้อง/);
  for (const value of [
    '2026-02-30T00:00:00Z',
    '2026-01-01T25:00:00Z',
    '2026-01-01',
    'private-invalid-timestamp',
  ])
    assert.throws(
      () => timestamp(value),
      (error) => error instanceof Error && !error.message.includes(String(value)),
    );
  assert.equal(day('2028-02-29'), '2028-02-29');
  assert.equal(timestamp('2026-11-06T03:00:00+07:00'), '2026-11-06T03:00:00+07:00');
  assert.equal(day(undefined), '');
  const h = repository();
  h.tables.tasks[0].fields['Created At'] = '2026-11-06';
  assert.equal(taskDto(h.tables.tasks[0]).createdAt, '2026-11-06');
});

test('unknown status, priority and ambiguous task ownership cannot be silently converted to defaults', () => {
  const h = repository(),
    task = h.tables.tasks[0];
  for (const fields of [
    { Status: 'Archived' },
    { Priority: 'Maybe' },
    { Agent: [] },
    { Agent: [rid(2), rid(3)] },
    { 'Due Date': '2026-02-30' },
  ])
    assert.throws(
      () => taskDto({ ...task, fields: { ...task.fields, ...fields } }),
      /ข้อมูลบางรายการไม่ถูกต้อง/,
    );
  assert.throws(() =>
    followupDto({
      id: rid(81),
      fields: { Task: [rid(11)], 'Follow-up Status': 'Pending', 'Follow-up Date': '' },
    }),
  );
  assert.throws(() =>
    updateDto({ id: rid(82), fields: { Task: [rid(11), rid(12)], Message: 'Ambiguous' } }),
  );
});

test('attachment values are sanitized and task summaries omit all detail-only fields', () => {
  const h = repository(),
    record = {
      ...h.tables.tasks[0],
      fields: {
        ...h.tables.tasks[0].fields,
        'Reference URL': 'javascript:alert(1)',
        Attachments: [
          null,
          {},
          { filename: 'No', url: 'http://example.test/file' },
          { filename: 'No', url: 'https://user:password@example.test/file' },
          { filename: 'เอกสาร.pdf', url: 'https://example.test/file.pdf' },
        ],
      },
    };
  const detail = taskDto(record),
    summary = taskSummaryDto(record);
  assert.deepEqual(detail.attachments, [
    { name: 'เอกสาร.pdf', url: 'https://example.test/file.pdf' },
  ]);
  assert.equal(detail.referenceUrl, '');
  for (const field of ['attachments', 'referenceUrl', 'completedAt', 'version', 'secretaryId'])
    assert.equal(field in summary, false);
});

test('context bootstrap skips task listing and invalid unrelated records cannot deny an Agent their own rows', async () => {
  const h = repository();
  h.tables.tasks[1].fields['Due Date'] = 'invalid-private-day';
  assert.deepEqual(
    (await bootstrap(h.repo, h.agent)).tasks.map((task) => task.id),
    [rid(11)],
  );
  h.calls.length = 0;
  const context = await bootstrap(h.repo, h.agent, 'context');
  assert.equal(context.tasksIncluded, false);
  assert.deepEqual(context.tasks, []);
  assert.deepEqual(h.calls, []);
  await bootstrap(h.repo, h.secretary, 'context');
  assert.deepEqual(h.calls, ['list:users']);
  await assert.rejects(bootstrap(h.repo, h.secretary), /ข้อมูลบางรายการไม่ถูกต้อง/);
});

test('unfinished directory rows do not block manager pages or become authorized users', async () => {
  const h = repository();
  const unfinished = [
    { id: rid(90), fields: {} },
    { id: rid(91), fields: { 'Full Name': 'Draft user', Active: true, Role: 'Unknown' } },
  ];
  h.tables.users.push(...unfinished);
  h.tables.users[2].fields.Active = false;
  for (const role of ['Admin', 'Secretary'] as const) {
    for (const scope of ['full', 'context'] as const) {
      const result = await bootstrap(h.repo, { ...h.secretary, role }, scope);
      assert.deepEqual(result.users.map((user) => user.id), [rid(1), rid(2), rid(3)]);
      assert.equal(result.users[2].active, false);
      assert.equal(result.tasks.length, scope === 'full' ? 2 : 0);
      assert.ok(result.users.every((user) => !('email' in user) && !('sub' in user)));
    }
  }
  for (const row of unfinished) assert.throws(() => userDto(row), /ไม่มีสิทธิ์/);
});
