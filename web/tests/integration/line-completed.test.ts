import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, repository, config, rid } from '../fixtures';
import { Journal } from '../../src/server/operations/journal';
import { mutate } from '../../src/server/services/mutations';
import {
  startLink,
  receiveWebhook,
  confirmLink,
  setAgentPreference,
  setRecipient,
} from '../../src/server/line/accounts';
import { drainLineQueue } from '../../src/server/line/queue';
import { taskDto } from '../../src/server/airtable/dto';
const cfg = {
  ...config,
  ENABLE_LINE_NOTIFICATIONS: true,
  LINE_CHANNEL_ACCESS_TOKEN: 'test-token-never-live-1234',
  LINE_CHANNEL_SECRET: 'test-secret-never-live',
  LINE_OA_ID: '@test',
  LINE_BOT_USER_ID: 'U' + 'a'.repeat(32),
};
const lineA = 'U' + '2'.repeat(32),
  lineB = 'U' + '3'.repeat(32);

test('Agents confirm their own LINE and opt in without Admin access; other account bindings and role changes cannot inherit subscription', async () => {
  const { db, engine } = await database(),
    h = repository();
  try {
    for (const [user, id] of [
      [h.agent, lineA],
      [h.other, lineB],
    ] as const) {
      const { code } = await startLink(db, cfg, user);
      await receiveWebhook(db, cfg, {
        destination: cfg.LINE_BOT_USER_ID,
        events: [
          {
            type: 'message',
            timestamp: Date.now(),
            source: { type: 'user', userId: id },
            message: { type: 'text', text: code },
          },
        ],
      });
      await confirmLink(db, cfg, user, id, async () =>
        Response.json({ userId: id, displayName: user.name }),
      );
    }
    const accounts = (await db.query('SELECT * FROM hvr_line_accounts ORDER BY user_id')).rows;
    assert.equal(accounts[0].recipient_role, 'Agent');
    assert.equal(accounts[0].enabled, false);
    await assert.rejects(setAgentPreference(db, cfg, h.agent, accounts[1].binding, true));
    await assert.rejects(setAgentPreference(db, cfg, h.secretary, accounts[0].binding, true));
    await assert.rejects(
      setRecipient(db, cfg, h.repo, h.agent, h.agent.id, accounts[0].binding, true),
    );
    await setAgentPreference(db, cfg, h.agent, accounts[0].binding, true);
    assert.equal(
      (await db.query('SELECT enabled FROM hvr_line_accounts WHERE user_id=$1', [h.other.id]))
        .rows[0].enabled,
      false,
    );
    await setAgentPreference(db, cfg, h.agent, accounts[0].binding, false);
    await db.query("UPDATE hvr_line_accounts SET recipient_role='Secretary' WHERE user_id=$1", [
      h.agent.id,
    ]);
    await assert.rejects(setAgentPreference(db, cfg, h.agent, accounts[0].binding, true));
  } finally {
    await engine.close();
  }
});

test('only the opted-in owner receives a real Completed transition; retries/repeated saves do not duplicate; no internal notes in LINE', async () => {
  const { db, engine } = await database(),
    h = repository();
  try {
    await db.query('INSERT INTO hvr_line_settings(environment,enabled) VALUES($1,true)', [
      config.APP_ENV,
    ]);
    for (const [user, id, role] of [
      [h.agent, lineA, 'Agent'],
      [h.other, lineB, 'Agent'],
      [h.secretary, 'U' + '1'.repeat(32), 'Secretary'],
    ] as const)
      await db.query(
        'INSERT INTO hvr_line_accounts(environment,user_id,line_id,display_name,enabled,recipient_role) VALUES($1,$2,$3,$4,true,$5)',
        [config.APP_ENV, user.id, id, user.name, role],
      );
    const journal = new Journal(db, config);
    const status = async (value: string, key = randomUUID()) => {
      const task = taskDto(await h.repo.get('tasks', rid(11)));
      const payload = {
        id: task.id,
        version: task.version,
        status: value,
        message: 'PRIVATE SECRETARY COMMENT',
      };
      const run = () =>
        journal.execute(h.secretary.id, key, 'status', payload, 'task:' + task.id, (steps) =>
          mutate(h.repo, h.secretary, 'status', payload, steps),
        );
      assert.equal((await run()).state, 'completed');
      assert.equal((await run()).state, 'completed');
    };
    await status('In Progress');
    assert.equal((await db.query('SELECT * FROM hvr_line_deliveries')).rows.length, 0);
    await status('Completed');
    await status('Completed');
    let rows = (await db.query('SELECT * FROM hvr_line_deliveries')).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, h.agent.id);
    assert.equal(rows[0].event_type, 'task_completed');
    assert.ok(!JSON.stringify(rows).includes('PRIVATE'));
    let sent = '';
    const push: typeof fetch = async (_url, init) => {
      sent = String(init?.body);
      return new Response('{}');
    };
    await drainLineQueue(db, cfg, h.repo, push);
    const request = JSON.parse(sent);
    assert.equal(request.to, lineA);
    assert.match(sent, /งานของคุณเสร็จสิ้นแล้ว/);
    assert.ok(!sent.includes('PRIVATE'));
    assert.match(sent, /openExternalBrowser=1/);
    await status('In Progress');
    await status('Completed');
    rows = (await db.query('SELECT * FROM hvr_line_deliveries')).rows;
    assert.equal(rows.length, 2);
    // Revocation after queueing is checked before sending; another Agent never receives it.
    h.tables.tasks[0].fields.Agent = [h.other.id];
    sent = '';
    await drainLineQueue(db, cfg, h.repo, push);
    assert.equal(sent, '');
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM hvr_line_deliveries WHERE state='cancelled'"))
        .rows[0].n,
      1,
    );
    // Agent subscriptions must not turn into recipients of new-task broadcasts.
    const key = randomUUID(),
      payload = {
        title: 'New task',
        description: 'private',
        category: 'วันเกิดตัวแทนและลูกค้า',
        priority: 'Normal',
        dueDate: '2026-11-12',
      };
    await journal.execute(h.agent.id, key, 'create', payload, 'create:' + key, (steps) =>
      mutate(h.repo, h.agent, 'create', payload, steps),
    );
    const broadcasts = (
      await db.query("SELECT user_id FROM hvr_line_deliveries WHERE event_type='new_task'")
    ).rows;
    assert.deepEqual(
      broadcasts.map((r) => r.user_id),
      [h.secretary.id],
    );
    // Disabling a recipient excludes future completion events, including replay.
    await db.query('UPDATE hvr_line_accounts SET enabled=false WHERE user_id=$1', [h.other.id]);
    await status('In Progress');
    await status('Completed');
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM hvr_line_deliveries WHERE event_type='task_completed'",
        )
      ).rows[0].n,
      2,
    );
  } finally {
    await engine.close();
  }
});

test('reopened tasks and opt-out cancel pending completion delivery; old completed tasks never backfill', async () => {
  const { db, engine } = await database(),
    h = repository();
  try {
    await db.query('INSERT INTO hvr_line_settings(environment,enabled) VALUES($1,true)', [
      config.APP_ENV,
    ]);
    await db.query(
      "INSERT INTO hvr_line_accounts(environment,user_id,line_id,display_name,enabled,recipient_role) VALUES($1,$2,$3,$4,false,'Agent')",
      [config.APP_ENV, h.agent.id, lineA, h.agent.name],
    );
    const status = async (value: string) => {
      const key = randomUUID(),
        task = taskDto(await h.repo.get('tasks', rid(11))),
        payload = { id: task.id, version: task.version, status: value, message: '' };
      return new Journal(db, config).execute(
        h.secretary.id,
        key,
        'status',
        payload,
        'task:' + task.id,
        (steps) => mutate(h.repo, h.secretary, 'status', payload, steps),
      );
    };
    await status('Completed');
    await db.query('UPDATE hvr_line_accounts SET enabled=true');
    await status('Completed');
    assert.equal((await db.query('SELECT * FROM hvr_line_deliveries')).rows.length, 0);
    await status('In Progress');
    await status('Completed');
    await status('In Progress');
    let calls = 0;
    const push: typeof fetch = async () => {
      calls++;
      return new Response('{}');
    };
    await drainLineQueue(db, cfg, h.repo, push);
    assert.equal(calls, 0);
    await status('Completed');
    await db.query('UPDATE hvr_line_accounts SET enabled=false');
    await drainLineQueue(db, cfg, h.repo, push);
    assert.equal(calls, 0);
    assert.ok(
      (await db.query('SELECT state FROM hvr_line_deliveries')).rows.every(
        (r) => r.state === 'cancelled',
      ),
    );
  } finally {
    await engine.close();
  }
});
