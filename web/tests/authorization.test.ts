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
        dueDate: '2026-11-06',
        category: 'งานทั่วไป',
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
  for (const action of ['status', 'followup', 'resolveFollowup'] as const)
    assert.throws(() => validateMutation(action, { role: 'Admin' }, h.agent));
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
