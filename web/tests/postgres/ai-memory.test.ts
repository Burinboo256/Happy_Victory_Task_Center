import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { config, migrationSql, repository, rid } from '../fixtures';
import {
  beginMemory,
  memoryIsCurrent,
  memorySession,
  readMemory,
  rememberReply,
} from '../../src/server/ai/memory';

test('PostgreSQL isolates concurrent memory sessions and clear prevents stale answers being restored', async () => {
  const raw = process.env.TEST_DATABASE_URL;
  assert.ok(raw, 'TEST_DATABASE_URL is required');
  assert.match(new URL(raw).pathname, /test/i);
  assert.notEqual(raw, process.env.DATABASE_URL);
  const schema = 'hvr_test_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString: raw, max: 1 });
  const db = new Pool({ connectionString: raw, max: 5, options: '-c search_path=' + schema });
  try {
    await admin.query('CREATE SCHEMA ' + schema);
    for (const sql of await migrationSql()) await db.query(sql);
    await db.query('INSERT INTO hvr_instances(environment,base_id) VALUES($1,$2)', [
      config.APP_ENV,
      config.AIRTABLE_BASE_ID,
    ]);
    const h = repository(),
      binding = randomUUID();
    await db.query(
      "INSERT INTO hvr_ai_accounts(environment,user_id,line_id,binding,display_name) VALUES($1,$2,$3,$4,'test')",
      [config.APP_ENV, h.agent.id, 'U' + '1'.repeat(32), binding],
    );
    const epochs = await Promise.all(
      Array.from({ length: 5 }, () => memorySession(db, config, h.agent, binding)),
    );
    assert.equal(new Set(epochs).size, 1);
    const epoch = epochs[0],
      ids: string[] = [];
    for (let i = 0; i < 9; i++)
      ids.push(
        await beginMemory(
          db,
          config,
          h.agent,
          epoch,
          randomUUID(),
          'question ' + i,
          [rid(11)],
          [{ id: rid(11), code: 'HVR-00001' }],
        ),
      );
    // Responses arrive concurrently, including older responses after newer ones.
    await Promise.all(
      ids
        .slice(3)
        .reverse()
        .map((id, i) => rememberReply(db, config, id, 'answer ' + i)),
    );
    await Promise.all(ids.slice(0, 3).map((id) => rememberReply(db, config, id, 'late answer')));
    assert.deepEqual(
      (await readMemory(db, config, h.agent, epoch)).map((t) => t.question),
      ['question 3', 'question 4', 'question 5', 'question 6', 'question 7', 'question 8'],
    );
    const pending = await beginMemory(db, config, h.agent, epoch, randomUUID(), 'pending', [], []);
    assert.equal(await memoryIsCurrent(db, config, pending), true);
    // Pause after reading the old row, then clear on another connection before UPDATE.
    let release = () => {},
      entered = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const saved = rememberReply(
      {
        query: async (sql, values) => {
          const result = await db.query(sql, values);
          if (sql.includes('SELECT task_refs')) {
            entered();
            await gate;
          }
          return result;
        },
      },
      config,
      pending,
      'must not return',
    );
    await started;
    const next = await memorySession(db, config, h.agent, binding, true);
    assert.notEqual(next, epoch);
    release();
    await saved;
    assert.equal(await memoryIsCurrent(db, config, pending), false);
    assert.deepEqual(await readMemory(db, config, h.agent, next), []);
    await assert.rejects(beginMemory(db, config, h.agent, epoch, randomUUID(), 'stale', [], []));
    assert.equal((await db.query('SELECT * FROM hvr_ai_memory_turns')).rows.length, 0);
  } finally {
    await db.end();
    assert.match(schema, /^hvr_test_[a-f0-9]{32}$/);
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    await admin.end();
  }
});
