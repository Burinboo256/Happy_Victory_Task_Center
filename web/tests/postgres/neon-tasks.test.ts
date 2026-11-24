import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { config, repository, migrationSql } from '../fixtures';
import { importTasks, activateTasks } from '../../src/server/task-store/import';
import { taskRepository } from '../../src/server/task-store/repository';
import { taskOperation } from '../../src/server/task-store/operation';
import { mutate } from '../../src/server/services/mutations';
import { drainTaskMirror } from '../../src/server/task-store/sync';
import { ApplicationPool } from '../../src/server/db';
import { AirtableClient } from '../../src/server/airtable/client';

test('Neon concurrent retry commits once and mirror HTTP never locks interactive writes', async () => {
  const raw = process.env.TEST_DATABASE_URL;
  assert.ok(raw);
  assert.match(new URL(raw).pathname, /test/i);
  assert.notEqual(raw, process.env.DATABASE_URL);
  const schema = 'hvr_test_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString: raw, max: 1 });
  const db = new Pool({ connectionString: raw, max: 6, options: '-c search_path=' + schema });
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    for (const sql of await migrationSql()) await db.query(sql);
    await db.query('INSERT INTO hvr_instances(environment,base_id) VALUES($1,$2)', [
      config.APP_ENV,
      config.AIRTABLE_BASE_ID,
    ]);
    await db.query('INSERT INTO hvr_runtime(environment,task_writes) VALUES($1,false)', [
      config.APP_ENV,
    ]);
    const h = repository();
    await importTasks(db, config, h.repo);
    await activateTasks(db, config, h.repo);
    const repo = await taskRepository(db, config, h.repo);
    const request = randomUUID(),
      data = {
        title: 'Concurrent',
        description: 'Synthetic',
        caseName: 'Person',
        priority: 'Normal',
        category: 'ตัวแทนใหม่',
        dueDate: '2026-12-01',
      };
    const run = () =>
      taskOperation(
        db,
        config,
        repo,
        h.agent.id,
        request,
        'create',
        data,
        'create:' + request,
        (steps, r) => mutate(r, h.agent, 'create', data, steps),
      );
    const result = await Promise.all([run(), run()]);
    assert.equal(result[0].result?.id, result[1].result?.id);
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM hvr_operations WHERE action='create'"))
        .rows[0].n,
      1,
    );
    assert.ok(result[0].result);
    const id = result[0].result.id;
    let release!: () => void, started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const delayed = {
      ...h.repo,
      upsert: async (...args: Parameters<typeof h.repo.upsert>) => {
        started();
        await waiting;
        return h.repo.upsert(...args);
      },
    };
    const worker = drainTaskMirror(db, config, delayed, 1);
    await began;
    try {
      const saved = await Promise.race([
        repo.patch('tasks', id, { 'Task Title': 'Saved while mirror waits' }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('mirror blocked app write')), 2000),
        ),
      ]);
      assert.equal(saved.fields['Task Title'], 'Saved while mirror waits');
      assert.equal(
        (await drainTaskMirror(db, config, h.repo, 1)).processed,
        0,
        'second worker does not overtake',
      );
    } finally {
      release();
      await worker;
    }
    await drainTaskMirror(db, config, h.repo, 10);
    const mapped = (
      await db.query("SELECT airtable_id FROM hvr_task_records WHERE kind='tasks' AND id=$1", [id])
    ).rows[0].airtable_id;
    assert.equal(
      h.tables.tasks.find((r) => r.id === mapped)?.fields['Task Title'],
      'Saved while mirror waits',
    );
  } finally {
    await db.end();
    assert.match(schema, /^hvr_test_[a-f0-9]{32}$/);
    await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
    await admin.end();
  }
});

test('three concurrent Secretary writes can check live owners with every app connection occupied', async () => {
  const raw = process.env.TEST_DATABASE_URL;
  assert.ok(raw);
  assert.match(new URL(raw).pathname, /test/i);
  assert.notEqual(raw, process.env.DATABASE_URL);
  const schema = 'hvr_test_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString: raw, max: 1 });
  const db = new ApplicationPool({
    connectionString: raw,
    max: 3,
    connectionTimeoutMillis: 1500,
    options: '-c search_path=' + schema,
  });
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    for (const sql of await migrationSql()) await db.query(sql);
    await db.query('INSERT INTO hvr_instances(environment,base_id) VALUES($1,$2)', [
      config.APP_ENV,
      config.AIRTABLE_BASE_ID,
    ]);
    await db.query('INSERT INTO hvr_runtime(environment,task_writes) VALUES($1,false)', [
      config.APP_ENV,
    ]);
    const h = repository();
    await importTasks(db, config, h.repo);
    await activateTasks(db, config, h.repo);
    let ownerChecks = 0;
    const client = new AirtableClient(config, db, async (url, init) => {
      assert.equal(init?.method, 'GET');
      assert.equal(new URL(String(url)).pathname.split('/').at(-1), h.agent.id);
      ownerChecks++;
      return Response.json(await h.repo.get('users', h.agent.id));
    });
    const repo = await taskRepository(db, config, client);
    let entered = 0,
      release!: () => void;
    const allOccupied = new Promise<void>((resolve) => {
      release = resolve;
    });
    const results = await Promise.all(
      Array.from({ length: 3 }, async (_, index) => {
        const request = randomUUID();
        const data = {
          title: 'Concurrent Secretary ' + index,
          description: 'Synthetic',
          caseName: 'Person',
          agentId: h.agent.id,
          priority: 'Normal',
          category: 'ตัวแทนใหม่',
          dueDate: '2026-12-01',
        };
        return taskOperation(
          db,
          config,
          repo,
          h.secretary.id,
          request,
          'create',
          data,
          'create:' + request,
          async (steps, scoped) => {
            if (++entered === 3) release();
            await allOccupied;
            assert.equal(db.totalCount, 3);
            return mutate(scoped, h.secretary, 'create', data, steps);
          },
        );
      }),
    );
    assert.equal(ownerChecks, 3);
    assert.equal(new Set(results.map((r) => r.result?.id)).size, 3);
    assert.ok(results.every((r) => r.state === 'completed'));
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM hvr_operations WHERE state='completed' AND action='create'",
        )
      ).rows[0].n,
      3,
    );
    assert.ok(db.rateLimits.totalCount <= 2);
    // No cross-request identity cache: the next owner check sees revocation immediately.
    const agent = h.tables.users.find((r) => r.id === h.agent.id);
    assert.ok(agent);
    agent.fields.Active = false;
    const request = randomUUID();
    await assert.rejects(
      taskOperation(
        db,
        config,
        repo,
        h.secretary.id,
        request,
        'create',
        {},
        'create:' + request,
        (steps, scoped) =>
          mutate(
            scoped,
            h.secretary,
            'create',
            {
              title: 'Rejected',
              description: 'Synthetic',
              caseName: 'Person',
              agentId: h.agent.id,
              priority: 'Normal',
              category: 'ตัวแทนใหม่',
              dueDate: '2026-12-01',
            },
            steps,
          ),
      ),
      { code: 'AGENT_INACTIVE' },
    );
  } finally {
    await db.end();
    assert.match(schema, /^hvr_test_[a-f0-9]{32}$/);
    await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
    await admin.end();
  }
});
