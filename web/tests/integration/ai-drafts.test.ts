import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { database, repository, config, rid } from '../fixtures';
import { receiveAi, replyAi } from '../../src/server/ai/line';
import { draftInput, finishDraft, draftPostback, cleanDrafts } from '../../src/server/ai/drafts';
import { UncertainWrite } from '../../src/server/errors';

function required<T>(value: T | null | undefined): T {
  assert.ok(value != null);
  return value;
}
const sender = 'U' + '1'.repeat(32),
  bot = 'U' + 'a'.repeat(32);
const c = {
  ...config,
  AI_LINE_ENABLED: true,
  AI_LINE_CHANNEL_SECRET: 'test-ai-secret',
  AI_LINE_CHANNEL_ACCESS_TOKEN: 'test-ai-token',
  AI_LINE_OA_ID: '@test',
  AI_LINE_BOT_USER_ID: bot,
};
const fields = {
  title: 'ติดตาม Memo สมมติ',
  description: 'ช่วยตรวจเอกสารที่ยังขาด',
  caseName: 'บุคคลสมมติ ทดสอบ',
  category: 'ลูกค้าใหม่',
  priority: 'Urgent',
  dueDate: '2026-12-01',
  agentId: rid(2),
};
function signed(text: string, data?: string) {
  const raw = JSON.stringify({
    destination: bot,
    events: [
      {
        webhookEventId: randomUUID(),
        type: data ? 'postback' : 'message',
        timestamp: Date.now(),
        source: { type: 'user', userId: sender },
        replyToken: 'single-event-token',
        ...(data ? { postback: { data } } : { message: { type: 'text', text } }),
      },
    ],
  });
  return [
    raw,
    createHmac('sha256', c.AI_LINE_CHANNEL_SECRET).update(raw).digest('base64'),
  ] as const;
}
async function setup() {
  const { db, engine } = await database(),
    h = repository(),
    binding = randomUUID();
  await db.query(
    `INSERT INTO hvr_ai_accounts(environment,user_id,line_id,binding,display_name) VALUES($1,$2,$3,$4,'test')`,
    [c.APP_ENV, h.agent.id, sender, binding],
  );
  return { db, engine, h, binding };
}

test('signed LINE flow drafts without writes, requires a button, creates once and queues secretary notification', async () => {
  const { db, engine, h } = await setup();
  try {
    await db.query(`INSERT INTO hvr_line_settings(environment,enabled) VALUES($1,true)`, [
      c.APP_ENV,
    ]);
    await db.query(
      `INSERT INTO hvr_line_accounts(environment,user_id,line_id,display_name,enabled)
      VALUES($1,$2,$3,'Secretary',true)`,
      [c.APP_ENV, rid(1), 'U' + '3'.repeat(32)],
    );
    const message = signed('ส่งงานลูกค้าใหม่ ติดตาม Memo ด่วนมาก กำหนดส่ง 1 ธันวาคม 2569');
    const result = await receiveAi(db, c, h.repo, ...message);
    assert.equal(result.jobs[0].draft?.mode, 'draft');
    assert.equal(result.jobs[0].context, undefined);
    assert.deepEqual(result.jobs[0].draft?.agents, [{ id: h.agent.id, name: h.agent.name }]);
    assert.equal((await receiveAi(db, c, h.repo, ...message)).jobs.length, 0);
    const sent: { messages: { text?: string; template?: { actions: { data: string }[] } }[] }[] =
      [];
    const transport: typeof fetch = async (_url, options) => {
      sent.push(JSON.parse(String(options?.body)));
      return Response.json({});
    };
    await replyAi(
      db,
      c,
      h.repo,
      result.jobs[0].ticket,
      JSON.stringify({ ...fields, agentId: rid(3) }),
      transport,
    );
    assert.equal(h.tables.tasks.length, 2);
    assert.match(required(sent[0].messages[0].text), /2026-12-01/);
    assert.match(required(sent[0].messages[0].text), /Agent A/);
    const button = required(sent[0].messages[1].template).actions[0].data;
    // Typing the label or model-generated prose never creates anything.
    const typed = await receiveAi(db, c, h.repo, ...signed('ยืนยันสร้างงาน'));
    assert.equal(typed.jobs[0].needsAi, false);
    assert.equal(h.tables.tasks.length, 2);
    const confirm = signed('', button);
    assert.equal((await receiveAi(db, c, h.repo, ...confirm)).taskConfirmed, true);
    assert.equal((await receiveAi(db, c, h.repo, ...confirm)).jobs.length, 0);
    assert.equal((await receiveAi(db, c, h.repo, ...signed('', button))).taskConfirmed, true);
    assert.equal(h.tables.tasks.length, 3);
    assert.deepEqual(h.tables.tasks[2].fields.Agent, [rid(2)]);
    assert.equal(h.tables.tasks[2].fields.Status, 'New');
    assert.equal((await db.query('SELECT * FROM hvr_operations')).rows.length, 1);
    assert.equal((await db.query('SELECT * FROM hvr_line_deliveries')).rows.length, 1);
  } finally {
    await engine.close();
  }
});

test('LINE explicitly asks for a case name and accepts it without an AI extraction call', async () => {
  const { db, engine, h, binding } = await setup();
  try {
    const first = required(await draftInput(db, c, h.repo, h.agent, sender, binding, 'ส่งงาน'));
    const reply = await finishDraft(
      db,
      c,
      h.repo,
      h.agent,
      required(first.draft).id,
      required(first.draft).revision,
      binding,
      JSON.stringify({ ...fields, caseName: null }),
    );
    assert.match(reply.text, /ชื่อลูกค้า:/);
    assert.equal(
      reply.actions?.some((a) => a.label === 'ยืนยันสร้างงาน'),
      false,
    );
    const named = required(
      await draftInput(db, c, h.repo, h.agent, sender, binding, 'ชื่อลูกค้า: คุณสมมติ ทดสอบ'),
    );
    assert.equal(named.context, undefined);
    assert.match(required(named.reply).text, /ชื่อลูกค้า: คุณสมมติ ทดสอบ/);
    const confirm = required(named.reply?.actions?.find((a) => a.label === 'ยืนยันสร้างงาน'));
    await draftPostback(db, c, h.repo, h.agent, sender, binding, confirm.data);
    assert.equal(h.tables.tasks.at(-1)?.fields['Case Name'], 'คุณสมมติ ทดสอบ');
    assert.deepEqual(h.tables.tasks.at(-1)?.fields.Agent, [h.agent.id]);
  } finally {
    await engine.close();
  }
});

test('multi-turn missing fields, edits, cancel and stale AI responses cannot use an earlier confirmation', async () => {
  const { db, engine, h, binding } = await setup();
  try {
    const input = (q: string) => draftInput(db, c, h.repo, h.agent, sender, binding, q);
    const first = required(await input('ส่งงาน'));
    const incomplete = await finishDraft(
      db,
      c,
      h.repo,
      h.agent,
      required(first.draft).id,
      required(first.draft).revision,
      binding,
      JSON.stringify({
        title: fields.title,
        description: fields.description,
        caseName: 'บุคคลสมมติ ทดสอบ',
        category: fields.category,
      }),
    );
    assert.match(incomplete.text, /กำหนดส่งวันไหน/);
    assert.equal(
      incomplete.actions?.some((a) => a.label === 'ยืนยันสร้างงาน'),
      false,
    );
    const next = required(await input('1 ธันวาคม 2569'));
    assert.equal(next.context?.current.title, fields.title);
    const ready = await finishDraft(
      db,
      c,
      h.repo,
      h.agent,
      required(next.draft).id,
      required(next.draft).revision,
      binding,
      JSON.stringify({ dueDate: fields.dueDate }),
    );
    const old = required(ready.actions)[0].data;
    await draftPostback(db, c, h.repo, h.agent, sender, binding, required(ready.actions)[1].data);
    const changed = required(await input('เปลี่ยนเป็นปกติ'));
    assert.match(
      (await draftPostback(db, c, h.repo, h.agent, sender, binding, old)).text,
      /เปลี่ยนแล้ว/,
    );
    await input('ยกเลิก');
    const stale = await finishDraft(
      db,
      c,
      h.repo,
      h.agent,
      required(changed.draft).id,
      required(changed.draft).revision,
      binding,
      JSON.stringify(fields),
    );
    assert.match(stale.text, /เปลี่ยนแล้ว/);
    assert.equal(h.tables.tasks.length, 2);
    assert.equal(
      (await db.query('SELECT fields FROM hvr_ai_drafts')).rows[0].fields.title,
      undefined,
    );
  } finally {
    await engine.close();
  }
});

test('invalid AI output, spoofed capabilities, disabled writes, expiry and revoked bindings fail closed', async () => {
  const { db, engine, h, binding } = await setup();
  try {
    const first = required(await draftInput(db, c, h.repo, h.agent, sender, binding, 'ส่งงาน'));
    const id = required(first.draft).id,
      rev = required(first.draft).revision;
    const bad = await finishDraft(
      db,
      c,
      h.repo,
      h.agent,
      id,
      rev,
      binding,
      JSON.stringify({ ...fields, action: 'confirm' }),
    );
    assert.match(bad.text, /ไม่สำเร็จ/);
    const date = await finishDraft(
      db,
      c,
      h.repo,
      h.agent,
      id,
      rev,
      binding,
      JSON.stringify({ ...fields, dueDate: '2026-02-31' }),
    );
    assert.match(date.text, /ไม่สำเร็จ/);
    const ready = await finishDraft(
      db,
      c,
      h.repo,
      h.agent,
      id,
      rev,
      binding,
      JSON.stringify(fields),
    );
    const button = required(ready.actions)[0].data;
    const forged = button.slice(0, -1) + (button.endsWith('a') ? 'b' : 'a');
    await assert.rejects(draftPostback(db, c, h.repo, h.agent, sender, binding, forged));
    assert.match(
      (await draftPostback(db, c, h.repo, h.other, sender, binding, button)).text,
      /เปลี่ยนแล้ว/,
    );
    await db.query('UPDATE hvr_runtime SET task_writes=false');
    await assert.rejects(draftPostback(db, c, h.repo, h.agent, sender, binding, button));
    await db.query('UPDATE hvr_runtime SET task_writes=true');
    await db.query('DELETE FROM hvr_ai_accounts');
    await assert.rejects(draftPostback(db, c, h.repo, h.agent, sender, binding, button));
    await db.query("UPDATE hvr_ai_drafts SET expires_at=now()-interval '1 minute'");
    await cleanDrafts(db, c);
    assert.equal((await db.query('SELECT state FROM hvr_ai_drafts')).rows[0].state, 'expired');
    assert.equal(h.tables.tasks.length, 2);
  } finally {
    await engine.close();
  }
});

test('manager chooses an active Agent and role changes block confirmation and model replies', async () => {
  const { db, engine, h, binding } = await setup();
  try {
    await db.query('UPDATE hvr_ai_accounts SET user_id=$1', [h.secretary.id]);
    const first = await receiveAi(db, c, h.repo, ...signed('ส่งงานลูกค้าใหม่'));
    assert.equal(first.jobs[0].draft?.agents.length, 2);
    const sent: { messages: { template?: { actions: { data: string }[] } }[] }[] = [];
    const transport: typeof fetch = async (_url, options) => {
      sent.push(JSON.parse(String(options?.body)));
      return Response.json({});
    };
    await replyAi(
      db,
      c,
      h.repo,
      first.jobs[0].ticket,
      JSON.stringify({ ...fields, agentId: rid(3) }),
      transport,
    );
    const button = required(sent[0].messages[1].template).actions[0].data;
    h.tables.users[2].fields.Active = false;
    await assert.rejects(draftPostback(db, c, h.repo, h.secretary, sender, binding, button));
    h.tables.users[2].fields.Active = true;
    h.tables.users[0].fields.Role = 'Agent';
    await assert.rejects(draftPostback(db, c, h.repo, h.secretary, sender, binding, button));
    assert.equal(h.tables.tasks.length, 2);
    h.tables.users[0].fields.Role = 'Secretary';
    assert.equal(
      (await draftPostback(db, c, h.repo, h.secretary, sender, binding, button)).created,
      true,
    );
    assert.deepEqual(h.tables.tasks[2].fields.Agent, [rid(3)]);
  } finally {
    await engine.close();
  }
});

test('ambiguous Airtable writes stay tied to the original operation and cannot create a second task', async () => {
  const { db, engine, h, binding } = await setup();
  try {
    const first = required(await draftInput(db, c, h.repo, h.agent, sender, binding, 'ส่งงาน'));
    const ready = await finishDraft(
      db,
      c,
      h.repo,
      h.agent,
      required(first.draft).id,
      required(first.draft).revision,
      binding,
      JSON.stringify(fields),
    );
    const upsert = h.repo.upsert.bind(h.repo);
    h.repo.upsert = async (...args) => {
      const result = await upsert(...args);
      if (args[0] === 'tasks') throw new UncertainWrite();
      return result;
    };
    const button = required(ready.actions)[0].data;
    const pending = await draftPostback(db, c, h.repo, h.agent, sender, binding, button);
    assert.match(pending.text, /ยังตรวจสอบ/);
    await draftPostback(db, c, h.repo, h.agent, sender, binding, button);
    const again = await draftInput(db, c, h.repo, h.agent, sender, binding, 'ส่งงานเดิมอีกครั้ง');
    assert.equal(again?.context, undefined);
    assert.equal(h.tables.tasks.length, 3);
    assert.equal((await db.query('SELECT * FROM hvr_operations')).rows.length, 1);
    assert.equal((await db.query('SELECT state FROM hvr_operations')).rows[0].state, 'review');
  } finally {
    await engine.close();
  }
});
