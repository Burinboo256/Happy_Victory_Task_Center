import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { config, migrationSql, repository } from '../fixtures';
import { draftInput, finishDraft, draftPostback } from '../../src/server/ai/drafts';

test('PostgreSQL serializes simultaneous draft confirmation, edit and duplicate requests', async () => {
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
    await db.query('INSERT INTO hvr_runtime(environment,task_writes) VALUES($1,true)', [
      config.APP_ENV,
    ]);
    const h = repository(),
      binding = randomUUID(),
      sender = 'U' + '1'.repeat(32);
    await db.query(
      `INSERT INTO hvr_ai_accounts(environment,user_id,line_id,binding,display_name) VALUES($1,$2,$3,$4,'test')`,
      [config.APP_ENV, h.agent.id, sender, binding],
    );
    const input = () => draftInput(db, config, h.repo, h.agent, sender, binding, 'ส่งงาน');
    const started = await Promise.all([input(), input()]);
    const d = started.find((r) => r?.draft)?.draft;
    assert.ok(d);
    assert.equal(started.filter((r) => r?.draft).length, 1);
    const ready = await finishDraft(
      db,
      config,
      h.repo,
      h.agent,
      d.id,
      d.revision,
      binding,
      JSON.stringify({
        title: 'Concurrent test',
        description: 'Synthetic',
        category: 'ลูกค้าใหม่',
        dueDate: '2026-12-01',
      }),
    );
    assert.ok(ready.actions);
    const confirm = ready.actions[0].data,
      edit = ready.actions[1].data;
    const post = (data: string) =>
      draftPostback(db, config, h.repo, h.agent, sender, binding, data);
    // Hold the external write open while another Function receives the same confirmation.
    let enter = () => {},
      release = () => {};
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const upsert = h.repo.upsert.bind(h.repo);
    h.repo.upsert = async (...args) => {
      if (args[0] === 'tasks') {
        enter();
        await gate;
      }
      return upsert(...args);
    };
    const first = post(confirm);
    try {
      await entered;
      const duplicate = await post(confirm);
      assert.match(duplicate.text, /ยังตรวจสอบ/);
      assert.match((await post(edit)).text, /เปลี่ยนแล้ว/);
    } finally {
      release();
    }
    assert.equal((await first).created, true);
    assert.equal((await post(confirm)).created, true);
    assert.equal(h.tables.tasks.length, 3);
    assert.equal((await db.query('SELECT * FROM hvr_operations')).rows.length, 1);
    assert.equal((await db.query('SELECT state FROM hvr_ai_drafts')).rows[0].state, 'completed');
  } finally {
    await db.end();
    assert.match(schema, /^hvr_test_[a-f0-9]{32}$/);
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    await admin.end();
  }
});
