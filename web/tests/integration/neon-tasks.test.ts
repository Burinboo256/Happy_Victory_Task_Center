import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, repository, config, rid } from '../fixtures';
import { importTasks, activateTasks } from '../../src/server/task-store/import';
import { NeonTaskRepository, taskRepository } from '../../src/server/task-store/repository';
import { taskOperation } from '../../src/server/task-store/operation';
import {
  drainTaskMirror,
  taskSyncStatus,
  reviewTaskMirror,
} from '../../src/server/task-store/sync';
import { mutate } from '../../src/server/services/mutations';
import { detail, bootstrap } from '../../src/server/services/reads';
import { aiContext } from '../../src/server/ai/context';
import { AppError, UncertainWrite } from '../../src/server/errors';
import { compileFilter } from '../../src/server/task-store/filter';
import { atomic } from '../../src/server/db';
import { createOperationalSchema, workspaceDatabase } from '../../src/server/workspaces/database';

test('Neon cutover preserves records, authorization, atomic writes, AI reads and ordered mirror', async () => {
  const { db, engine } = await database();
  const h = repository();
  try {
    assert.equal(await taskRepository(db, config, h.repo), h.repo);
    await assert.rejects(importTasks(db, config, h.repo), { code: 'IMPORT_WRITES_ACTIVE' });
    await db.query('UPDATE hvr_runtime SET task_writes=false');
    const imported = await importTasks(db, config, h.repo);
    assert.equal(imported.counts.tasks, 2);
    await activateTasks(db, config, h.repo);
    const repo = await taskRepository(db, config, h.repo);
    assert.ok(repo instanceof NeonTaskRepository);
    assert.deepEqual(await repo.get('tasks', rid(11)), h.tables.tasks[0]);
    await assert.rejects(importTasks(db, config, h.repo), { code: 'IMPORT_ALREADY_ACTIVE' });
    await assert.rejects(detail(repo, h.agent, rid(12)), { code: 'FORBIDDEN' });
    await assert.rejects(repo.get('tasks', rid(9999)), { status: 404 });
    assert.equal((await bootstrap(repo, h.agent)).tasks.length, 1);
    const context = await aiContext(db, config, repo, h.agent, 'สรุปงานวันนี้');
    assert.ok(context);
    const create = {
      title: '[NEON TEST] สร้างงาน',
      description: 'ข้อมูลสมมติ',
      caseName: 'ตัวแทนสมมติ',
      priority: 'Normal',
      category: 'ตัวแทนใหม่',
      dueDate: '2026-12-01',
      referenceUrl: '',
    };
    const requestId = randomUUID();
    const run = (payload: unknown = create) =>
      taskOperation(
        db,
        config,
        repo,
        h.agent.id,
        requestId,
        'create',
        payload,
        `create:${requestId}`,
        (steps, r) => mutate(r, h.agent, 'create', payload, steps),
      );
    const before = h.calls.length;
    const result = await run();
    assert.equal(result.state, 'completed');
    assert.ok(result.result);
    assert.equal((await run()).result?.id, result.result.id);
    assert.equal(h.calls.length, before, 'task create does not call Airtable');
    await assert.rejects(run({ ...create, title: 'changed' }), { code: 'IDEMPOTENCY_CONFLICT' });
    const taskId = result.result.id;
    const task = await repo.get('tasks', taskId);
    const byCode = await aiContext(db, config, repo, h.agent, 'สถานะ ' + task.fields['Task ID']);
    assert.deepEqual(
      byCode.taskRefs.map((t) => t.id),
      [taskId],
    );
    assert.ok(task.fields['Created At']);
    assert.equal(task.fields['Last Update'], 'neon:1');
    assert.equal((await repo.list('updates', `{Task Record ID}="${taskId}"`)).length, 1);
    const beforeFailure = (await taskSyncStatus(db, config)).pending;
    await assert.rejects(
      taskOperation(
        db,
        config,
        repo,
        h.agent.id,
        randomUUID(),
        'test',
        {},
        `task:${taskId}`,
        async (_s, r) => {
          await r.patch('tasks', taskId, { Status: 'Completed' });
          throw new Error('simulated failure after data and outbox insert');
        },
      ),
      /simulated/,
    );
    assert.equal((await repo.get('tasks', taskId)).fields.Status, 'New');
    assert.equal((await taskSyncStatus(db, config)).pending, beforeFailure);
    await repo.patch('tasks', taskId, { 'Task Title': 'รุ่นสอง' });
    const mirrored = await drainTaskMirror(db, config, h.repo, 10);
    assert.equal(mirrored.review, 0);
    assert.equal(mirrored.pending, 0);
    const mirrorId = (
      await db.query("SELECT airtable_id FROM hvr_task_records WHERE kind='tasks' AND id=$1", [
        taskId,
      ])
    ).rows[0].airtable_id;
    assert.notEqual(mirrorId, taskId);
    assert.equal(h.tables.tasks.find((r) => r.id === mirrorId)?.fields['Task Title'], 'รุ่นสอง');
    assert.deepEqual(h.tables.updates[0].fields.Task, [mirrorId]);
    const calls = h.calls.length;
    await drainTaskMirror(db, config, h.repo, 10);
    assert.equal(h.calls.length, calls, 'completed events are not redelivered');
    await repo.patch('tasks', taskId, { Priority: 'High' });
    const unavailable = {
      ...h.repo,
      patch: async () => {
        throw new AppError(503, 'AIRTABLE_BUSY', 'busy', 30);
      },
    };
    assert.equal((await drainTaskMirror(db, config, unavailable)).pending, 1);
    assert.equal(
      (await repo.get('tasks', taskId)).fields.Priority,
      'High',
      'Neon save survives outage',
    );
    await db.query(
      "UPDATE hvr_airtable_outbox SET next_attempt_at=clock_timestamp() WHERE state='pending'",
    );
    const ambiguous = {
      ...h.repo,
      patch: async () => {
        throw new UncertainWrite();
      },
    };
    assert.equal((await drainTaskMirror(db, config, ambiguous)).review, 1);
    await repo.patch('tasks', taskId, { Priority: 'Urgent' });
    const blocked = await drainTaskMirror(db, config, h.repo);
    assert.equal(blocked.processed, 0, 'newer version cannot overtake uncertain write');
    assert.equal(blocked.pending, 1);
    const review = (await db.query("SELECT version FROM hvr_airtable_outbox WHERE state='review'"))
      .rows[0];
    await assert.rejects(
      reviewTaskMirror(
        db,
        config,
        h.repo,
        'tasks',
        taskId,
        Number(review.version),
        'no evidence',
        false,
      ),
      { code: 'SYNC_REVIEW_EVIDENCE' },
    );
    await reviewTaskMirror(
      db,
      config,
      h.repo,
      'tasks',
      taskId,
      Number(review.version),
      'fixture confirms request stopped',
      true,
    );
    assert.equal((await drainTaskMirror(db, config, h.repo, 10)).pending, 0);
    assert.equal(h.tables.tasks.find((r) => r.id === mirrorId)?.fields.Priority, 'Urgent');
    h.tables.users[1].fields.Active = false;
    assert.equal(
      (await repo.get('users', h.agent.id)).fields.Active,
      false,
      'Control users remain live',
    );
    assert.throws(() => compileFilter('{Agent Record ID}="x" OR TRUE', []), {
      code: 'TASK_FILTER_UNSUPPORTED',
    });
  } finally {
    await engine.close();
  }
});

test('import detects drift, orphan links and unfinished operations without enabling Neon', async () => {
  const { db, engine } = await database();
  const h = repository();
  try {
    await db.query('UPDATE hvr_runtime SET task_writes=false');
    h.tables.updates.push({ id: rid(88), fields: { Task: [rid(9999)] } });
    await assert.rejects(importTasks(db, config, h.repo), { code: 'IMPORT_ORPHAN' });
    h.tables.updates = [];
    await importTasks(db, config, h.repo);
    h.tables.tasks[0].fields['Task Title'] = 'changed after snapshot';
    await assert.rejects(activateTasks(db, config, h.repo), { code: 'IMPORT_MISMATCH' });
    assert.equal(await taskRepository(db, config, h.repo), h.repo);
  } finally {
    await engine.close();
  }
});

test('Neon operations preserve new-task/completed LINE events and do not leak same IDs across Spaces', async () => {
  const { db, engine } = await database();
  const h = repository();
  try {
    await db.query('UPDATE hvr_runtime SET task_writes=false');
    await importTasks(db, config, h.repo);
    await activateTasks(db, config, h.repo);
    const repo = await taskRepository(db, config, h.repo);
    await db.query('INSERT INTO hvr_line_settings(environment,enabled) VALUES($1,true)', [
      config.APP_ENV,
    ]);
    for (const [user, role] of [
      [h.secretary, 'Secretary'],
      [h.agent, 'Agent'],
    ] as const)
      await db.query(
        'INSERT INTO hvr_line_accounts(environment,user_id,line_id,display_name,enabled,recipient_role) VALUES($1,$2,$3,$4,true,$5)',
        [config.APP_ENV, user.id, `U${user.id}`, user.name, role],
      );
    const input = {
      title: 'New test',
      description: 'Synthetic',
      caseName: 'Person',
      priority: 'Normal',
      category: 'ตัวแทนใหม่',
      dueDate: '2026-12-01',
    };
    const created = await taskOperation(
      db,
      config,
      repo,
      h.agent.id,
      randomUUID(),
      'create',
      input,
      'create:test',
      (steps, r) => mutate(r, h.agent, 'create', input, steps),
    );
    assert.ok(created.result);
    assert.equal(
      (await db.query("SELECT 1 FROM hvr_line_deliveries WHERE event_type='new_task'")).rows.length,
      1,
    );
    const task = await repo.get('tasks', created.result.id);
    const status = {
      id: task.id,
      version: String(task.fields['Last Update']),
      status: 'Completed',
      message: '',
    };
    const requestId = randomUUID();
    const complete = () =>
      taskOperation(
        db,
        config,
        repo,
        h.secretary.id,
        requestId,
        'status',
        status,
        `task:${task.id}`,
        (steps, r) => mutate(r, h.secretary, 'status', status, steps),
      );
    await complete();
    await complete();
    assert.equal(
      (await db.query("SELECT 1 FROM hvr_line_deliveries WHERE event_type='task_completed'")).rows
        .length,
      1,
    );
    const schema = `hvr_ws_${'b'.repeat(32)}`,
      base = 'app00000000000099';
    await atomic(db, (tx) => createOperationalSchema(tx, schema, config.APP_ENV, base));
    const otherDb = workspaceDatabase(db, schema),
      otherConfig = { ...config, AIRTABLE_BASE_ID: base };
    const other = repository();
    other.tables.tasks[0].fields['Task Title'] = 'Space B only';
    await otherDb.query('UPDATE hvr_runtime SET task_writes=false');
    await importTasks(otherDb, otherConfig, other.repo);
    await activateTasks(otherDb, otherConfig, other.repo);
    const otherRepo = await taskRepository(otherDb, otherConfig, other.repo);
    assert.equal((await otherRepo.get('tasks', rid(11))).fields['Task Title'], 'Space B only');
    assert.notEqual((await repo.get('tasks', rid(11))).fields['Task Title'], 'Space B only');
    await assert.rejects(otherRepo.get('tasks', task.id), { status: 404 });
    await assert.rejects(taskRepository(otherDb, config, other.repo), {
      code: 'TASK_STORAGE_BINDING',
    });
    assert.equal(
      (await drainTaskMirror(otherDb, config, h.repo)).processed,
      0,
      'wrong Base cannot drain',
    );
  } finally {
    await engine.close();
  }
});
