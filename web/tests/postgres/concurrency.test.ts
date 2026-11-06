import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Journal } from '../../src/server/operations/journal';
import { AirtableClient } from '../../src/server/airtable/client';
import type { Sql } from '../../src/server/db';
import { UncertainWrite } from '../../src/server/errors';
import { config, rid, migrationSql, repository } from '../fixtures';
import { OperationRecovery } from '../../src/server/operations/recovery';

test('real PostgreSQL coordinates concurrent Function instances without expiring active reservations', async (t) => {
  const raw = process.env.TEST_DATABASE_URL;
  assert.ok(
    raw,
    'Set TEST_DATABASE_URL to a disposable PostgreSQL database; this test is not silently skipped.',
  );
  const url = new URL(raw);
  assert.match(url.pathname, /test/i, 'Only a named test database may be used');
  assert.notEqual(
    raw,
    process.env.DATABASE_URL,
    'The application database must not be used for disposable tests',
  );
  const schema = 'hvr_test_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString: raw, max: 1 });
  const db = new Pool({ connectionString: raw, max: 5, options: '-c search_path=' + schema });
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    for (const sql of await migrationSql()) await db.query(sql);
    await db.query('INSERT INTO hvr_instances(environment,base_id) VALUES ($1,$2)', [
      config.APP_ENV,
      config.AIRTABLE_BASE_ID,
    ]);
    await db.query('INSERT INTO hvr_runtime(environment) VALUES ($1)', [config.APP_ENV]);
    await t.test(
      'two instances processing the same key perform the external step only once',
      async () => {
        let enter = () => {},
          release = () => {};
        const entered = new Promise<void>((resolve) => {
          enter = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const key = randomUUID();
        let writes = 0;
        const first = new Journal(db, config).execute(
          rid(2),
          key,
          'comment',
          { message: 'test' },
          'task:' + rid(11),
          (steps) =>
            steps.run('audit', async () => {
              writes++;
              enter();
              await gate;
              return { id: rid(11) };
            }),
        );
        try {
          await entered;
          const second = await new Journal(db, config).execute(
            rid(2),
            key,
            'comment',
            { message: 'test' },
            'task:' + rid(11),
            async () => {
              throw new Error('Must not run');
            },
          );
          assert.equal(second.state, 'running');
        } finally {
          release();
        }
        assert.equal((await first).state, 'completed');
        assert.equal(writes, 1);
      },
    );
    await t.test(
      'different operation cannot take an active or uncertain task reservation',
      async () => {
        let enter = () => {},
          release = () => {};
        const entered = new Promise<void>((resolve) => {
          enter = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const first = new Journal(db, config).execute(
          rid(1),
          randomUUID(),
          'status',
          {},
          'task:' + rid(12),
          (steps) =>
            steps.run('patch', async () => {
              enter();
              await gate;
              throw new UncertainWrite();
            }),
        );
        try {
          await entered;
          await assert.rejects(
            new Journal(db, config).execute(
              rid(2),
              randomUUID(),
              'status',
              {},
              'task:' + rid(12),
              async () => ({ id: rid(12) }),
            ),
            /คำขอที่ยังบันทึกไม่ครบ/,
          );
        } finally {
          release();
        }
        assert.equal((await first).state, 'review');
        await assert.rejects(
          new Journal(db, config).execute(
            rid(1),
            randomUUID(),
            'status',
            {},
            'task:' + rid(12),
            async () => ({ id: rid(12) }),
          ),
          /คำขอที่ยังบันทึกไม่ครบ/,
        );
      },
    );
    await t.test(
      'concurrent recovery operators cannot both advance the same revision',
      async () => {
        const h = repository(),
          key = randomUUID();
        const result = await new Journal(db, config).execute(
          rid(1),
          key,
          'status',
          { id: rid(11), status: 'Completed' },
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
                fields: { Status: 'Completed', 'Completed At': null },
              },
            ),
        );
        h.tables.tasks[0].fields.Status = 'Completed';
        let entered = 0,
          release = () => {};
        const barrier = new Promise<void>((resolve) => {
          release = resolve;
        });
        const get = h.repo.get;
        h.repo.get = async (...args) => {
          if (++entered === 2) release();
          await barrier;
          return get(...args);
        };
        const input = {
          id: result.operationId,
          confirmNoInflight: result.operationId,
          action: 'reconcile' as const,
          operator: 'test',
          evidence: 'test/CAS',
        };
        const results = await Promise.allSettled([
          new OperationRecovery(db, config, h.repo).run(input),
          new OperationRecovery(db, config, h.repo).run(input),
        ]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal(
          (
            await db.query('SELECT * FROM hvr_recovery_events WHERE operation_id=$1', [
              result.operationId,
            ])
          ).rows.length,
          1,
        );
        assert.equal(
          (await db.query('SELECT state FROM hvr_operations WHERE id=$1', [result.operationId]))
            .rows[0].state,
          'pending',
        );
        assert.equal(
          h.calls.some((c) => c.startsWith('patch:') || c.startsWith('upsert:')),
          false,
        );
      },
    );
    await t.test('request slots are shared across client instances', async () => {
      const calls: number[] = [];
      const transport: typeof fetch = async () => {
        calls.push(Date.now());
        return Response.json({ records: [] });
      };
      const a = new AirtableClient(config, db, transport),
        b = new AirtableClient(config, db, transport);
      await Promise.all([
        a.list('users'),
        b.list('users'),
        a.list('tasks'),
        b.list('tasks'),
        a.list('updates'),
      ]);
      assert.equal(calls.length, 5);
      assert.ok(
        Math.max(...calls) - Math.min(...calls) >= 750,
        'parallel requests must reserve globally spaced slots',
      );
    });
    await t.test(
      'rejected overload does not extend the queue or the upstream cooldown',
      async () => {
        await db.query('DELETE FROM hvr_rate_limits WHERE base_id=$1', [config.AIRTABLE_BASE_ID]);
        let upstreamCalls = 0;
        const transport: typeof fetch = async () => {
          upstreamCalls++;
          return Response.json({ records: [] });
        };
        await db.query(
          `INSERT INTO hvr_rate_limits(base_id,next_at,blocked_until)
         VALUES ($1,clock_timestamp()+interval '4 seconds',clock_timestamp()+interval '30 seconds')`,
          [config.AIRTABLE_BASE_ID],
        );
        const before = (
          await db.query('SELECT next_at,blocked_until FROM hvr_rate_limits WHERE base_id=$1', [
            config.AIRTABLE_BASE_ID,
          ])
        ).rows[0];
        const results = await Promise.allSettled(
          Array.from({ length: 40 }, () => new AirtableClient(config, db, transport).list('users')),
        );
        assert.equal(
          results.every((result) => result.status === 'rejected'),
          true,
        );
        assert.equal(upstreamCalls, 0);
        const after = (
          await db.query('SELECT next_at,blocked_until FROM hvr_rate_limits WHERE base_id=$1', [
            config.AIRTABLE_BASE_ID,
          ])
        ).rows[0];
        assert.equal(
          after.next_at.toISOString(),
          before.next_at.toISOString(),
          'rejected requests may not reserve future slots',
        );
        assert.equal(after.blocked_until.toISOString(), before.blocked_until.toISOString());
        for (const result of results) {
          if (result.status !== 'rejected') throw new Error('Expected busy response');
          assert.equal(result.reason.code, 'AIRTABLE_BUSY');
          assert.ok(result.reason.retryAfter >= 28 && result.reason.retryAfter <= 30);
        }
        await db.query(
          `UPDATE hvr_rate_limits SET next_at=clock_timestamp()-interval '1 second',blocked_until=clock_timestamp()-interval '1 second' WHERE base_id=$1`,
          [config.AIRTABLE_BASE_ID],
        );
        await new AirtableClient(config, db, transport).list('users');
        assert.equal(upstreamCalls, 1, 'traffic resumes when the existing cooldown ends');
      },
    );
    await t.test(
      'an already queued mutation observes a new 429 cooldown before dispatch',
      async () => {
        await db.query('DELETE FROM hvr_rate_limits WHERE base_id=$1', [config.AIRTABLE_BASE_ID]);
        let enter = () => {},
          release = () => {},
          reserved = () => {};
        const entered = new Promise<void>((done) => {
          enter = done;
        });
        const gate = new Promise<void>((done) => {
          release = done;
        });
        const secondReserved = new Promise<void>((done) => {
          reserved = done;
        });
        let calls = 0;
        const transport: typeof fetch = async () => {
          calls++;
          if (calls === 1) {
            enter();
            await gate;
            return new Response('private upstream details', { status: 429 });
          }
          return Response.json({ id: rid(11), fields: { Status: 'Completed' } });
        };
        const first = new AirtableClient(config, db, transport).list('users');
        await entered;
        // The second caller already has a valid future slot when the first response arrives.
        await db.query(
          `UPDATE hvr_rate_limits SET next_at=clock_timestamp()+interval '1 second' WHERE base_id=$1`,
          [config.AIRTABLE_BASE_ID],
        );
        const queuedDb = {
          async query(sql: string, values?: unknown[]) {
            const result = await db.query(sql, values);
            if (sql.startsWith('INSERT INTO hvr_rate_limits')) reserved();
            return result;
          },
        } as Sql;
        const second = new AirtableClient(config, queuedDb, transport).patch('tasks', rid(11), {
          Status: 'Completed',
        });
        await secondReserved;
        release();
        const results = await Promise.allSettled([first, second]);
        assert.equal(
          calls,
          1,
          'the queued mutation must not reach upstream during the new cooldown',
        );
        for (const result of results) {
          assert.equal(result.status, 'rejected');
          if (result.status !== 'rejected') throw new Error('Expected busy response');
          assert.equal(result.reason.code, 'AIRTABLE_BUSY');
          assert.equal(result.reason instanceof UncertainWrite, false, 'no write was dispatched');
          assert.ok(result.reason.retryAfter >= 28 && result.reason.retryAfter <= 30);
        }
      },
    );
  } finally {
    await db.end();
    // Only the generated test schema is removed, never an application schema.
    assert.match(schema, /^hvr_test_[a-f0-9]{32}$/);
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    await admin.end();
  }
});
