import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, detail } from '../src/server/services/reads';
import { mutate, validateMutation } from '../src/server/services/mutations';
import { repository, rid } from './fixtures';
import type { Steps } from '../src/server/operations/journal';

const steps = (): Steps => ({ key: 'test-key', run: async (_name, work) => work() });
test('Agent bootstrap excludes other owners and private identity fields with broad upstream results', async () => {
  const h = repository(),
    data = await bootstrap(h.repo, h.agent);
  assert.deepEqual(
    data.tasks.map((t) => t.id),
    [rid(11)],
  );
  assert.deepEqual(
    data.users.map((u) => u.id),
    [rid(2)],
  );
  assert.equal(JSON.stringify(data).includes('agent-b'), false);
  assert.equal('sub' in data.user, false);
});
test('ownership is checked before reading updates; Agent never receives internal followups', async () => {
  const h = repository();
  await assert.rejects(detail(h.repo, h.agent, rid(12)), /ไม่มีสิทธิ์/);
  assert.equal(h.calls.includes('list:updates'), false);
  h.tables.updates.push(
    { id: rid(21), fields: { Task: [rid(11)], Message: 'private', 'Visible to Agent': false } },
    { id: rid(22), fields: { Task: [rid(12)], Message: 'other', 'Visible to Agent': true } },
    { id: rid(23), fields: { Task: [rid(11)], Message: 'public', 'Visible to Agent': true } },
  );
  const result = await detail(h.repo, h.agent, rid(11));
  assert.deepEqual(
    result.updates.map((u) => u.message),
    ['public'],
  );
  assert.deepEqual(result.followups, []);
});
test('forged Agent owner and initial status are ignored; Agent comments are always visible', async () => {
  const h = repository(),
    data = validateMutation(
      'create',
      {
        title: 'Test',
        description: 'Test details',
        caseName: 'บุคคลสมมติ ทดสอบ',
        dueDate: '2026-11-06',
        category: 'ลูกค้าเก่า',
        priority: 'Normal',
        agentId: rid(3),
        role: 'Admin',
        status: 'Completed',
      },
      h.agent,
    );
  const result = await mutate(h.repo, h.agent, 'create', data, steps());
  const task = h.tables.tasks.find((t) => t.id === result.id);
  assert.ok(task);
  assert.deepEqual(task.fields.Agent, [h.agent.id]);
  assert.equal(task.fields.Status, 'New');
  await mutate(
    h.repo,
    h.agent,
    'comment',
    { id: rid(11), message: 'test', visible: false },
    steps(),
  );
  assert.equal(h.tables.updates.at(-1)?.fields['Visible to Agent'], true);
});
test('manager routes reject Agent even with forged payload role', () => {
  const h = repository();
  for (const action of ['edit', 'status', 'followup', 'resolveFollowup'] as const)
    assert.throws(() => validateMutation(action, { role: 'Admin' }, h.agent));
});

test('managers edit task metadata and transfer ownership without changing workflow or status', async () => {
  const h = repository();
  const payload = {
    id: rid(11),
    version: 'v1',
    title: 'Updated title',
    description: 'Updated description',
    caseName: 'บุคคลสมมติ ทดสอบ',
    agentId: h.other.id,
    priority: 'Urgent',
    dueDate: '2026-12-15',
  };
  await assert.rejects(mutate(h.repo, h.agent, 'edit', payload, steps()), /ไม่มีสิทธิ์/);
  await assert.rejects(
    mutate(h.repo, h.secretary, 'edit', { ...payload, version: 'stale' }, steps()),
    /แก้ไขแล้ว/,
  );
  await assert.rejects(
    mutate(h.repo, h.secretary, 'edit', { ...payload, agentId: h.secretary.id }, steps()),
    /Agent ที่เปิดใช้งาน/,
  );
  h.tables.users[2].fields.Active = false;
  await assert.rejects(mutate(h.repo, h.secretary, 'edit', payload, steps()), /Agent ที่เปิดใช้งาน/);
  assert.equal(h.calls.includes('patch:tasks'), false);
  h.tables.users[2].fields.Active = true;
  await mutate(
    h.repo,
    h.secretary,
    'edit',
    validateMutation('edit', payload, h.secretary),
    steps(),
  );
  await assert.rejects(detail(h.repo, h.agent, rid(11)), /ไม่มีสิทธิ์/);
  const result = await detail(h.repo, h.other, rid(11));
  assert.equal(result.task.title, payload.title);
  assert.equal(result.task.description, payload.description);
  assert.equal(result.task.caseName, payload.caseName);
  assert.equal(result.task.priority, 'Urgent');
  assert.equal(result.task.dueDate, payload.dueDate);
  assert.equal(result.task.status, 'New');
  assert.equal(result.task.category, 'งานทั่วไป');
  assert.equal(h.tables.updates.length, 1);
  assert.match(result.updates[0].message, /แก้ไขข้อมูลงาน.*Agent เจ้าของงาน/);
  assert.equal(h.tables.notifications.length, 0);
  for (const bad of [
    { title: ' ' },
    { description: '' },
    { caseName: ' ' },
    { dueDate: '2026-02-30' },
    { priority: 'invalid' },
    { status: 'Completed' },
  ])
    assert.throws(() => validateMutation('edit', { ...payload, ...bad }, h.secretary));
});

test('Admin can correct a closed task while retaining its inactive owner', async () => {
  const h = repository();
  h.tables.users[1].fields.Active = false;
  h.tables.tasks[0].fields.Status = 'Completed';
  h.tables.tasks[0].fields['Completed At'] = '2026-11-01T03:00:00Z';
  await mutate(
    h.repo,
    { ...h.secretary, role: 'Admin' },
    'edit',
    {
      id: rid(11),
      version: 'v1',
      title: 'Correction',
      description: 'Corrected',
      caseName: 'บุคคลสมมติ ทดสอบ',
      agentId: h.agent.id,
      priority: 'Normal',
      dueDate: '2026-12-15',
    },
    steps(),
  );
  assert.equal(h.tables.tasks[0].fields.Status, 'Completed');
  assert.equal(h.tables.tasks[0].fields['Completed At'], '2026-11-01T03:00:00Z');
});
test('stale status is rejected and repeated Completed preserves original timestamp', async () => {
  const h = repository();
  await assert.rejects(
    mutate(
      h.repo,
      h.secretary,
      'status',
      { id: rid(11), version: 'stale', status: 'Completed' },
      steps(),
    ),
    /แก้ไขแล้ว/,
  );
  Object.assign(h.tables.tasks[0].fields, {
    Status: 'Completed',
    'Completed At': '2026-11-01T03:00:00Z',
  });
  await mutate(
    h.repo,
    h.secretary,
    'status',
    { id: rid(11), version: 'v1', status: 'Completed' },
    steps(),
  );
  assert.equal(h.tables.tasks[0].fields['Completed At'], '2026-11-01T03:00:00Z');
  assert.equal(h.tables.notifications.length, 1);
});
test('followup resolution rejects another task and picks earliest remaining Pending', async () => {
  const h = repository();
  h.tables.followups.push({
    id: rid(31),
    fields: { Task: [rid(12)], 'Follow-up Status': 'Pending' },
  });
  await assert.rejects(
    mutate(
      h.repo,
      h.secretary,
      'resolveFollowup',
      { id: rid(11), followupId: rid(31), status: 'Done', notes: 'done' },
      steps(),
    ),
  );
  h.tables.followups.push({
    id: rid(32),
    fields: { Task: [rid(11)], 'Follow-up Status': 'Pending', 'Follow-up Date': '2026-11-10' },
  });
  await mutate(
    h.repo,
    h.secretary,
    'followup',
    { id: rid(11), date: '2026-11-07', notes: 'โทรติดตาม' },
    steps(),
  );
  assert.equal(h.tables.tasks[0].fields['Next Follow-up'], '2026-11-07');
  assert.equal(h.tables.updates.at(-1)?.fields['Visible to Agent'], false);
});
