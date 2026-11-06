import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, repository, config, rid } from '../fixtures';
import { Journal } from '../../src/server/operations/journal';
import { OperationRecovery } from '../../src/server/operations/recovery';
import { requireTaskReady } from '../../src/server/operations/task-ready';
import { UncertainWrite } from '../../src/server/errors';
import { mutate } from '../../src/server/services/mutations';

const data = {
  title: 'Synthetic recovery',
  description: 'No customer data',
  dueDate: '2026-11-06',
  category: 'งานทั่วไป',
  priority: 'Normal',
};
const input = (id: string) => ({
  id,
  action: 'reconcile' as const,
  confirmNoInflight: id,
  operator: 'local-test',
  evidence: 'TEST/recovery',
});

test('accepted create with lost response is proven by key and fields, then resumes without duplicate writes', async () => {
  const { db, engine } = await database(),
    h = repository();
  try {
    const upsert = h.repo.upsert;
    h.repo.upsert = async (...args) => {
      const record = await upsert(...args);
      if (args[0] === 'tasks') throw new UncertainWrite();
      return record;
    };
    const key = randomUUID();
    const run = () =>
      new Journal(db, config).execute(h.agent.id, key, 'create', data, 'new:' + key, (steps) =>
        mutate(h.repo, h.agent, 'create', data, steps),
      );
    const first = await run();
    assert.equal(first.state, 'review');
    const taskId = h.tables.tasks[2].id;
    await assert.rejects(requireTaskReady(db, config, h.repo, taskId), /ยังบันทึกไม่ครบ/);
    const recovery = new OperationRecovery(db, config, h.repo);
    // A local env flag cannot pretend that the shared DB is paused.
    await assert.rejects(
      new OperationRecovery(db, { ...config, TASK_WRITES_ENABLED: false }, h.repo).run(
        input(first.operationId),
      ),
      /Pause writes/,
    );
    await db.query('UPDATE hvr_runtime SET task_writes=false');
    await assert.rejects(
      recovery.run({ ...input(first.operationId), confirmNoInflight: randomUUID() }),
      /Confirm/,
    );
    const before = h.calls.filter((c) => /^(upsert|patch):/.test(c)).length;
    assert.deepEqual(await recovery.run(input(first.operationId)), {
      operationId: first.operationId,
      state: 'pending',
      confirmed: ['task'],
      unresolved: [],
    });
    assert.equal(h.calls.filter((c) => /^(upsert|patch):/.test(c)).length, before);
    assert.equal((await db.query('SELECT * FROM hvr_resources')).rows.length, 1);
    await assert.rejects(requireTaskReady(db, config, h.repo, taskId));
    await db.query('UPDATE hvr_runtime SET task_writes=true');
    assert.equal((await run()).state, 'completed');
    await requireTaskReady(db, config, h.repo, taskId);
    assert.equal(h.calls.filter((c) => c === 'upsert:tasks').length, 1);
    assert.equal(h.tables.tasks.length, 3);
    assert.equal(h.tables.updates.length, 1);
    assert.equal((await db.query('SELECT * FROM hvr_resources')).rows.length, 0);
    const event = (await db.query('SELECT * FROM hvr_recovery_events')).rows[0];
    assert.equal(event.operator_label, 'local-test');
    assert.deepEqual(event.confirmed_steps, ['task']);
  } finally {
    await engine.close();
  }
});

test('missing, duplicate, changed and unproven writes remain in review with their reservation', async () => {
  const { db, engine } = await database(),
    h = repository();
  try {
    const key = randomUUID();
    const result = await new Journal(db, config).execute(
      h.agent.id,
      key,
      'create',
      data,
      'new:' + key,
      (steps) =>
        steps.run(
          'task',
          async () => {
            throw new UncertainWrite();
          },
          true,
          {
            kind: 'upsert',
            table: 'tasks',
            keyField: 'Request Key',
            fields: { 'Request Key': steps.key, 'Task Title': data.title },
          },
        ),
    );
    await db.query('UPDATE hvr_runtime SET task_writes=false');
    const recover = () => new OperationRecovery(db, config, h.repo).run(input(result.operationId));
    assert.equal((await recover()).state, 'review');
    const record = {
      id: rid(71),
      fields: { 'Request Key': 'web:' + result.operationId, 'Task Title': 'Different' },
    };
    h.tables.tasks.push(record);
    assert.deepEqual((await recover()).unresolved, ['task']);
    record.fields['Task Title'] = data.title;
    h.tables.tasks.push({ ...record, id: rid(72) });
    assert.equal((await recover()).state, 'review');
    h.tables.tasks.pop();
    await db.query(
      "UPDATE hvr_operations SET steps=jsonb_set(steps,'{task,intent}','null') WHERE id=$1",
      [result.operationId],
    );
    assert.equal((await recover()).state, 'review');
    assert.equal((await db.query('SELECT * FROM hvr_resources')).rows.length, 1);
    assert.equal(
      h.calls.some((c) => /^(upsert|patch):/.test(c)),
      false,
    );
  } finally {
    await engine.close();
  }
});

test('running invocation requires explicit stopped attestation and minimum age; only review becomes pending', async () => {
  const { db, engine } = await database(),
    h = repository();
  try {
    const id = randomUUID();
    await db.query(
      `INSERT INTO hvr_operations(environment,id,user_id,request_id,fingerprint,resource,action,payload,state)
      VALUES($1,$2,$3,$4,'test','test-resource','comment','{}','running')`,
      [config.APP_ENV, id, h.agent.id, randomUUID()],
    );
    await db.query(
      'INSERT INTO hvr_resources(environment,resource,operation_id) VALUES($1,$2,$3)',
      [config.APP_ENV, 'test-resource', id],
    );
    await db.query('UPDATE hvr_runtime SET task_writes=false');
    const recovery = new OperationRecovery(db, config, h.repo);
    await assert.rejects(recovery.run(input(id)), /Only review/);
    await assert.rejects(recovery.run({ ...input(id), action: 'mark-stopped' }), /120 seconds/);
    await db.query(
      "UPDATE hvr_operations SET updated_at=clock_timestamp()-interval '3 minutes' WHERE id=$1",
      [id],
    );
    assert.equal((await recovery.run({ ...input(id), action: 'mark-stopped' })).state, 'review');
    assert.equal((await recovery.run(input(id))).state, 'pending');
    assert.equal((await db.query('SELECT * FROM hvr_resources')).rows.length, 1);
    assert.equal((await db.query('SELECT * FROM hvr_recovery_events')).rows.length, 2);
  } finally {
    await engine.close();
  }
});

test('status recovery compares the exact saved timestamp before continuing audit and pending notification', async () => {
  const { db, engine } = await database(),
    h = repository();
  try {
    const patch = h.repo.patch;
    h.repo.patch = async (...args) => {
      await patch(...args);
      throw new UncertainWrite();
    };
    const payload = { id: rid(11), version: 'v1', status: 'Completed', message: 'Synthetic' };
    const key = randomUUID();
    const run = () =>
      new Journal(db, config).execute(
        h.secretary.id,
        key,
        'status',
        payload,
        'task:' + rid(11),
        (steps) => mutate(h.repo, h.secretary, 'status', payload, steps),
      );
    const first = await run();
    assert.equal(first.state, 'review');
    await db.query('UPDATE hvr_runtime SET task_writes=false');
    const time = h.tables.tasks[0].fields['Completed At'];
    h.tables.tasks[0].fields['Completed At'] = '2020-01-01T00:00:00Z';
    assert.equal(
      (await new OperationRecovery(db, config, h.repo).run(input(first.operationId))).state,
      'review',
    );
    h.tables.tasks[0].fields['Completed At'] = time;
    assert.equal(
      (await new OperationRecovery(db, config, h.repo).run(input(first.operationId))).state,
      'pending',
    );
    await db.query('UPDATE hvr_runtime SET task_writes=true');
    assert.equal((await run()).state, 'completed');
    assert.equal(h.calls.filter((c) => c === 'patch:tasks').length, 1);
    assert.equal(h.tables.notifications.length, 1);
    assert.equal(h.tables.notifications[0].fields['Delivery Status'], 'Pending');
  } finally {
    await engine.close();
  }
});

test('next followup recovery checks current earliest Pending date before accepting a saved patch', async () => {
  const { db, engine } = await database(),
    h = repository();
  try {
    const patch = h.repo.patch;
    h.repo.patch = async (...args) => {
      await patch(...args);
      throw new UncertainWrite();
    };
    const payload = { id: rid(11), date: '2026-11-08', notes: 'Synthetic followup' };
    const key = randomUUID();
    const run = () =>
      new Journal(db, config).execute(
        h.secretary.id,
        key,
        'followup',
        payload,
        'task:' + rid(11),
        (steps) => mutate(h.repo, h.secretary, 'followup', payload, steps),
      );
    const first = await run();
    assert.equal(first.state, 'review');
    await db.query('UPDATE hvr_runtime SET task_writes=false');
    h.tables.followups.push({
      id: rid(81),
      fields: { Task: [rid(11)], 'Follow-up Status': 'Pending', 'Follow-up Date': '2026-11-07' },
    });
    const recovery = new OperationRecovery(db, config, h.repo);
    assert.deepEqual((await recovery.run(input(first.operationId))).unresolved, ['next']);
    // Broad upstream responses from another task must not affect the earliest date.
    h.tables.followups[1].fields.Task = [rid(12)];
    assert.equal((await recovery.run(input(first.operationId))).state, 'pending');
    await db.query('UPDATE hvr_runtime SET task_writes=true');
    assert.equal((await run()).state, 'completed');
    assert.equal(h.calls.filter((c) => c === 'patch:tasks').length, 1);
    assert.equal(h.tables.updates[0].fields['Visible to Agent'], false);
  } finally {
    await engine.close();
  }
});

test('resolved followup recovery verifies the parent task before continuing remaining steps', async () => {
  const { db, engine } = await database(),
    h = repository();
  try {
    h.tables.followups.push({
      id: rid(81),
      fields: { Task: [rid(11)], 'Follow-up Status': 'Pending', 'Follow-up Date': '2026-11-07' },
    });
    const patch = h.repo.patch;
    h.repo.patch = async (...args) => {
      const result = await patch(...args);
      if (args[0] === 'followups') throw new UncertainWrite();
      return result;
    };
    const payload = { id: rid(11), followupId: rid(81), status: 'Done', notes: 'Synthetic result' };
    const key = randomUUID();
    const run = () =>
      new Journal(db, config).execute(
        h.secretary.id,
        key,
        'resolveFollowup',
        payload,
        'task:' + rid(11),
        (steps) => mutate(h.repo, h.secretary, 'resolveFollowup', payload, steps),
      );
    const first = await run();
    assert.equal(first.state, 'review');
    await db.query('UPDATE hvr_runtime SET task_writes=false');
    h.tables.followups[0].fields.Task = [rid(12)];
    const recovery = new OperationRecovery(db, config, h.repo);
    assert.deepEqual((await recovery.run(input(first.operationId))).unresolved, ['resolve']);
    h.tables.followups[0].fields.Task = [rid(11)];
    assert.equal((await recovery.run(input(first.operationId))).state, 'pending');
    await db.query('UPDATE hvr_runtime SET task_writes=true');
    assert.equal((await run()).state, 'completed');
    assert.equal(h.calls.filter((c) => c === 'patch:followups').length, 1);
    assert.equal(h.tables.tasks[0].fields['Next Follow-up'], null);
  } finally {
    await engine.close();
  }
});

test('recovery refuses active jobs and aborts atomically if maintenance ends during evidence reads', async () => {
  const { db, engine } = await database(),
    h = repository();
  try {
    const first = await new Journal(db, config).execute(
      h.secretary.id,
      randomUUID(),
      'status',
      { id: rid(11), status: 'New' },
      'task:' + rid(11),
      (steps) =>
        steps.run(
          'patch',
          async () => {
            throw new UncertainWrite();
          },
          true,
          {
            kind: 'patch',
            table: 'tasks',
            recordId: rid(11),
            fields: { Status: 'New', 'Completed At': null },
          },
        ),
    );
    await db.query('UPDATE hvr_runtime SET task_writes=false,jobs=true');
    const recovery = new OperationRecovery(db, config, h.repo);
    await assert.rejects(recovery.run(input(first.operationId)), /Pause writes/);
    await db.query('UPDATE hvr_runtime SET jobs=false');
    const get = h.repo.get;
    h.repo.get = async (...args) => {
      await db.query('UPDATE hvr_runtime SET task_writes=true');
      return get(...args);
    };
    await assert.rejects(recovery.run(input(first.operationId)), /maintenance state changed/);
    assert.equal((await db.query('SELECT state FROM hvr_operations')).rows[0].state, 'review');
    assert.equal((await db.query('SELECT * FROM hvr_recovery_events')).rows.length, 0);
    assert.equal(
      (await db.query('SELECT steps FROM hvr_operations')).rows[0].steps.patch.state,
      'started',
    );
  } finally {
    await engine.close();
  }
});
