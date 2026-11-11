import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { database, repository, config, rid } from '../fixtures';
import { receiveAi, replyAi, disconnectAi } from '../../src/server/ai/line';
import { aiContext } from '../../src/server/ai/context';
import { beginMemory, memorySession, readMemory, rememberReply } from '../../src/server/ai/memory';

const sender = 'U' + '1'.repeat(32),
  otherSender = 'U' + '2'.repeat(32);
const c = {
  ...config,
  AI_LINE_ENABLED: true,
  AI_LINE_CHANNEL_SECRET: 'test-memory-secret',
  AI_LINE_CHANNEL_ACCESS_TOKEN: 'test-memory-token',
  AI_LINE_OA_ID: '@test-memory',
  AI_LINE_BOT_USER_ID: 'U' + 'a'.repeat(32),
};
const ok: typeof fetch = async () => Response.json({});

test('follow-up selects remembered cases beyond the list cap and retains multiple candidates for clarification', async () => {
  const { db, engine } = await database(),
    h = repository();
  try {
    for (let i = 100; i < 165; i++)
      h.tables.tasks.push({
        id: rid(i),
        fields: { ...h.tables.tasks[0].fields, 'Task ID': 'HVR-' + i, 'Due Date': '2027-01-01' },
      });
    const taskIds = h.tables.tasks.map((t) => t.id);
    const memory = [
      { question: 'สถานะ HVR-164', answer: 'HVR-164', task_ids: taskIds, focus_ids: [rid(164)] },
    ];
    const next = await aiContext(db, c, h.repo, h.secretary, 'แล้วเคสนี้กำหนดวันไหน', memory);
    assert.deepEqual(
      next.taskRefs.map((t) => t.id),
      [rid(164)],
    );
    memory[0].focus_ids = [rid(164), rid(163)];
    assert.equal(
      (await aiContext(db, c, h.repo, h.secretary, 'แล้วเคสนั้นล่ะ', memory)).context.items.length,
      2,
    );
    assert.equal(
      (await aiContext(db, c, h.repo, h.secretary, 'สรุปงานทั้งหมด', memory)).context.items.length,
      60,
    );
    assert.equal(
      (await aiContext(db, c, h.repo, h.secretary, 'สถานะ HVR-00001', memory)).context.items[0]
        .code,
      'HVR-00001',
    );
  } finally {
    await engine.close();
  }
});
async function harness() {
  const { db, engine } = await database(),
    h = repository();
  for (const [user, line] of [
    [h.agent, sender],
    [h.other, otherSender],
  ] as const)
    await db.query(
      "INSERT INTO hvr_ai_accounts(environment,user_id,line_id,display_name) VALUES($1,$2,$3,'test')",
      [c.APP_ENV, user.id, line],
    );
  const ask = async (text: string, line = sender) => {
    const raw = JSON.stringify({
      destination: c.AI_LINE_BOT_USER_ID,
      events: [
        {
          webhookEventId: randomUUID(),
          type: 'message',
          timestamp: Date.now(),
          source: { type: 'user', userId: line },
          replyToken: 'test-only',
          message: { type: 'text', text },
        },
      ],
    });
    return (
      await receiveAi(
        db,
        c,
        h.repo,
        raw,
        createHmac('sha256', c.AI_LINE_CHANNEL_SECRET).update(raw).digest('base64'),
      )
    ).jobs[0];
  };
  const send = (ticket: string, text: string, transport = ok) =>
    replyAi(db, c, h.repo, ticket, text, transport);
  return { db, engine, h, ask, send };
}

test('memory remembers delivered replies per account, uses fresh task state and explicit questions override focus', async () => {
  const { db, engine, h, ask, send } = await harness();
  try {
    const first = await ask('สถานะ HVR-00001');
    assert.deepEqual(first.context?.conversation.history, []);
    await send(first.ticket, 'HVR-00001 ยังไม่เสร็จ');
    h.tables.tasks[0].fields.Status = 'Completed';
    h.tables.tasks[0].fields['Due Date'] = '2026-12-02';
    const next = await ask('แล้วเคสนี้กำหนดส่งวันไหน');
    assert.equal(next.context?.conversation.history.length, 1);
    assert.equal(next.context?.conversation.followup, true);
    assert.equal(next.context?.items[0].dueDate, '2026-12-02');
    assert.equal(next.context?.items[0].status, 'เสร็จสิ้น');
    const other = await ask('แล้วเคสนี้ล่ะ', otherSender);
    assert.deepEqual(other.context?.conversation.history, []);
    assert.equal(other.context?.items.length, 0);
    assert.ok(!JSON.stringify(other).includes('HVR-00001'));
    const explicit = await ask('สถานะ HVR-00002');
    assert.equal(explicit.context?.items.length, 0);
    assert.equal(explicit.context?.conversation.followup, false);
    assert.equal((await ask('สรุปงานวันนี้')).context?.conversation.followup, false);
    assert.equal(
      (await db.query('SELECT count(*)::int n FROM hvr_ai_memory_turns WHERE answer IS NOT NULL'))
        .rows[0].n,
      1,
    );
  } finally {
    await engine.close();
  }
});

test('failed and pending replies are not remembered; clear invalidates in-flight answers and preserves task drafts', async () => {
  const { db, engine, ask, send } = await harness();
  try {
    const failed = await ask('สถานะ HVR-00001');
    await assert.rejects(
      send(failed.ticket, 'ไม่ควรถูกจำ', async () => new Response('', { status: 500 })),
    );
    const pending = await ask('สถานะ HVR-00001');
    assert.deepEqual(pending.context?.conversation.history, []);
    const draft = await ask('ส่งงานลูกค้าใหม่');
    assert.ok(draft.draft);
    const clear = await ask('ล้างความจำ');
    assert.equal(clear.needsAi, false);
    let sends = 0;
    await assert.rejects(
      send(pending.ticket, 'คำตอบที่ล้างแล้ว', async () => {
        sends++;
        return Response.json({});
      }),
    );
    assert.equal(sends, 0);
    assert.equal((await db.query('SELECT * FROM hvr_ai_memory_turns')).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM hvr_ai_drafts')).rows.length, 1);
    const after = await ask('สรุปงานวันนี้');
    assert.deepEqual(after.context?.conversation.history, []);
    await send(after.ticket, ''); // Provider failure uses fallback, not memory.
    assert.equal(
      (await db.query('SELECT * FROM hvr_ai_memory_turns WHERE answer IS NOT NULL')).rows.length,
      0,
    );
  } finally {
    await engine.close();
  }
});

test('memory drops reassigned task history, expires, resets on role/binding changes, cascades on disconnect', async () => {
  const { db, engine, h, ask, send } = await harness();
  try {
    await send((await ask('สถานะ HVR-00001')).ticket, 'HVR-00001 ข้อมูลเก่า');
    h.tables.tasks[0].fields.Agent = [h.other.id];
    assert.deepEqual((await ask('แล้วเคสนี้ล่ะ')).context?.conversation.history, []);
    h.tables.tasks[0].fields.Agent = [h.agent.id];
    await db.query(
      "UPDATE hvr_ai_memory_turns SET expires_at=clock_timestamp()-interval '1 second'",
    );
    assert.deepEqual((await ask('แล้วเคสนี้ล่ะ')).context?.conversation.history, []);
    await send((await ask('สถานะ HVR-00001')).ticket, 'HVR-00001 ก่อนเปลี่ยน role');
    h.tables.users[1].fields.Role = 'Secretary';
    assert.deepEqual((await ask('สรุปงานวันนี้')).context?.conversation.history, []);
    await send((await ask('สถานะ HVR-00001')).ticket, 'HVR-00001 ก่อนผูกใหม่');
    await db.query('UPDATE hvr_ai_accounts SET binding=gen_random_uuid() WHERE user_id=$1', [
      h.agent.id,
    ]);
    assert.deepEqual((await ask('สรุปงานวันนี้')).context?.conversation.history, []);
    await disconnectAi(db, c, h.agent);
    assert.equal((await db.query('SELECT * FROM hvr_ai_memory_turns')).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM hvr_ai_memory_sessions')).rows.length, 0);
  } finally {
    await engine.close();
  }
});

test('memory bounds six turns in arrival order and a clear during LINE send cannot resurrect history', async () => {
  const { db, engine, h, ask, send } = await harness();
  try {
    const binding = (
      await db.query('SELECT binding FROM hvr_ai_accounts WHERE user_id=$1', [h.agent.id])
    ).rows[0].binding;
    const epoch = await memorySession(db, c, h.agent, binding);
    const ids: string[] = [];
    for (let i = 0; i < 8; i++)
      ids.push(
        await beginMemory(
          db,
          c,
          h.agent,
          epoch,
          randomUUID(),
          'question ' + i,
          [rid(11)],
          [{ id: rid(11), code: 'HVR-00001' }],
        ),
      );
    for (let i = 7; i >= 0; i--) await rememberReply(db, c, ids[i], 'answer ' + i);
    assert.deepEqual(
      (await readMemory(db, c, h.agent, epoch)).map((t) => t.question),
      ['question 2', 'question 3', 'question 4', 'question 5', 'question 6', 'question 7'],
    );
    const job = await ask('สถานะ HVR-00001');
    await send(job.ticket, 'HVR-00001 ระหว่างล้าง', async () => {
      await memorySession(db, c, h.agent, binding, true);
      return Response.json({});
    });
    assert.equal((await db.query('SELECT * FROM hvr_ai_memory_turns')).rows.length, 0);
  } finally {
    await engine.close();
  }
});
