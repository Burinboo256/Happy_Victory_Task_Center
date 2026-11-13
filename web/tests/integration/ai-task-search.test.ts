import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { database, repository, config, rid } from '../fixtures';
import { receiveAi, replyAi } from '../../src/server/ai/line';
import { aiContext } from '../../src/server/ai/context';
import { taskSearchIntent, taskSearchContext } from '../../src/server/ai/task-search';
import { newCaseState } from '../../src/domain/case-workflow';

const sender = `U${'1'.repeat(32)}`;
const c = {
  ...config,
  AI_TASK_SEARCH_ENABLED: true,
  AI_LINE_ENABLED: true,
  AI_LINE_CHANNEL_SECRET: 'task-search-test-secret',
  AI_LINE_CHANNEL_ACCESS_TOKEN: 'task-search-test-token',
  AI_LINE_OA_ID: '@task-search',
  AI_LINE_BOT_USER_ID: `U${'a'.repeat(32)}`,
};
async function harness(manager = false) {
  const { db, engine } = await database(),
    h = repository();
  const user = manager ? h.secretary : h.agent;
  await db.query(
    "INSERT INTO hvr_ai_accounts(environment,user_id,line_id,display_name) VALUES($1,$2,$3,'test')",
    [c.APP_ENV, user.id, sender],
  );
  const ask = async (text: string, enabled = true) => {
    const raw = JSON.stringify({
      destination: c.AI_LINE_BOT_USER_ID,
      events: [
        {
          webhookEventId: randomUUID(),
          type: 'message',
          timestamp: Date.now(),
          source: { type: 'user', userId: sender },
          replyToken: 'test-only',
          message: { type: 'text', text },
        },
      ],
    });
    return (
      await receiveAi(
        db,
        { ...c, AI_TASK_SEARCH_ENABLED: enabled },
        h.repo,
        raw,
        createHmac('sha256', c.AI_LINE_CHANNEL_SECRET).update(raw).digest('base64'),
      )
    ).jobs[0];
  };
  const sent: string[] = [];
  const transport: typeof fetch = async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)).messages[0].text);
    return Response.json({});
  };
  const send = (ticket: string, text: string) => replyAi(db, c, h.repo, ticket, text, transport);
  return { db, engine, h, user, ask, send, sent };
}

test('search intent keeps daily summaries, explicit codes and task creation commands separate', () => {
  for (const q of [
    'หางานที่ยังรอเอกสาร',
    'เคสสมัครตัวแทนที่ยังไม่จบ',
    'ติดตามงานที่เกี่ยวกับการอบรม',
    'งานของ Agent A ถึงไหน',
  ])
    assert.ok(taskSearchIntent(q), q);
  for (const q of [
    'สรุปงานวันนี้',
    'สรุปงานทั้งหมด',
    'สถานะ HVR-00001',
    'แล้วเคสนี้ล่ะ',
    'ส่งงานใหม่ งานที่รอเอกสาร',
    'ดูร่าง',
    'ยกเลิก',
    'ยืนยันสร้างงาน',
    'รายละเอียด: หางานที่ยังค้าง',
  ])
    assert.equal(taskSearchIntent(q), false, q);
});

test('search includes a relevant job beyond the old 60 limit, refreshes status, and focuses only delivered results', async () => {
  const x = await harness(true);
  try {
    for (let i = 100; i < 180; i++)
      x.h.tables.tasks.push({
        id: rid(i),
        fields: {
          ...x.h.tables.tasks[0].fields,
          'Task ID': `HVR-${i}`,
          'Task Title': i === 179 ? 'สมัครอบรมตัวแทนสมมติ' : `งานสมมติ ${i}`,
          'Due Date': '2027-01-01',
        },
      });
    const job = await x.ask('หางานที่เกี่ยวกับการอบรม');
    assert.equal(job.taskSearch?.items.length, 82);
    assert.equal(job.context, undefined);
    assert.ok(job.taskSearch?.items.some((t) => t.id === rid(179)));
    const selected = x.h.tables.tasks.find((r) => r.id === rid(179));
    assert.ok(selected);
    selected.fields.Status = 'Completed';
    await x.send(job.ticket, JSON.stringify({ taskIds: [rid(179)] }));
    assert.ok(x.sent[0].includes('HVR-179'));
    assert.ok(x.sent[0].includes('เสร็จสิ้น'));
    assert.ok(x.sent[0].includes('ข้อมูล') && x.sent[0].includes('เปลี่ยนระหว่างค้น'));
    assert.ok(x.sent[0].includes(`/tasks/${rid(179)}`));
    const memory = (
      await x.db.query('SELECT focus_ids FROM hvr_ai_memory_turns WHERE answer IS NOT NULL')
    ).rows[0];
    assert.deepEqual(memory.focus_ids, [rid(179)]);
    await assert.rejects(x.send(job.ticket, JSON.stringify({ taskIds: [rid(179)] })));
    const next = await x.ask('แล้วเคสนี้กำหนดส่งวันไหน');
    assert.equal(next.context?.items[0].code, 'HVR-179');
    assert.equal(next.taskSearch, undefined);
  } finally {
    await x.engine.close();
  }
});

test('search never expands Agent scope or exposes private fields; managers receive allowed checklist labels only', async () => {
  const x = await harness();
  try {
    x.h.tables.tasks[0].fields.Category = 'ตัวแทนใหม่';
    x.h.tables.tasks[0].fields.Description = 'PRIVATE_DESCRIPTION';
    x.h.tables.tasks[0].fields['Case Name'] = 'PRIVATE_CASE_NAME';
    const state = newCaseState('ตัวแทนใหม่');
    state.fields.agentCode = 'PRIVATE_CODE';
    Object.values(state.items)[0].notes = 'PRIVATE_NOTES';
    await x.db.query(
      'INSERT INTO hvr_workflows(environment,resource,version,payload,operation_key) VALUES($1,$2,1,$3::jsonb,gen_random_uuid())',
      [c.APP_ENV, `case:${rid(11)}`, JSON.stringify(state)],
    );
    const job = await x.ask('เคสสมัครตัวแทนที่ยังไม่จบ');
    assert.deepEqual(
      job.taskSearch?.items.map((t) => t.id),
      [rid(11)],
    );
    assert.equal(job.taskSearch?.items[0].workflow?.missing, undefined);
    assert.ok(!JSON.stringify(job).includes('PRIVATE_'));
    assert.ok(!JSON.stringify(job).includes(rid(12)));
    assert.ok(!JSON.stringify(job.taskSearch).includes('http'));
    const manager = taskSearchContext(
      await aiContext(x.db, c, x.h.repo, x.h.secretary, 'เคสสมัครตัวแทนที่ยังไม่จบ', [], {
        search: true,
      }),
    );
    assert.ok(manager.items[0].workflow?.missing?.length);
    assert.ok(!JSON.stringify(manager).includes('PRIVATE_'));
    await x.send(job.ticket, JSON.stringify({ taskIds: [rid(12)] }));
    assert.ok(!x.sent[0].includes('HVR-00002'));
    assert.ok(!x.sent[0].includes('/tasks/'));
  } finally {
    await x.engine.close();
  }
});

test('empty or malformed selections never fall back to all jobs or focus the only candidate', async () => {
  const x = await harness();
  try {
    for (const response of [
      '',
      'old workflow summary',
      JSON.stringify({ taskIds: [] }),
      JSON.stringify({ taskIds: [rid(11)], answer: 'https://evil.test' }),
    ]) {
      const job = await x.ask('ค้นงานเกี่ยวกับการอบรม');
      await x.send(job.ticket, response);
      assert.ok(!x.sent.at(-1)?.includes('/tasks/'));
      assert.ok(!x.sent.at(-1)?.includes('evil.test'));
    }
    assert.ok(
      (await x.db.query('SELECT focus_ids FROM hvr_ai_memory_turns')).rows.every(
        (r) => r.focus_ids.length === 0,
      ),
    );
  } finally {
    await x.engine.close();
  }
});

test('search does not mutate drafts and the feature switch preserves existing summary handling', async () => {
  const x = await harness();
  try {
    const draft = await x.ask('ส่งงาน ติดตามลูกค้า');
    assert.ok(draft.draft);
    const before = (await x.db.query('SELECT fields,revision,state FROM hvr_ai_drafts')).rows;
    const search = await x.ask('หางานที่ยังค้าง');
    assert.ok(search.taskSearch);
    assert.equal(search.draft, undefined);
    assert.deepEqual(
      (await x.db.query('SELECT fields,revision,state FROM hvr_ai_drafts')).rows,
      before,
    );
    const summary = await x.ask('สรุปงานวันนี้');
    assert.ok(summary.context?.totals);
    assert.equal(summary.taskSearch, undefined);
    const disabled = await x.ask('สถานะงานที่ยังค้าง', false);
    assert.equal(disabled.taskSearch, undefined);
    assert.ok(disabled.context);
  } finally {
    await x.engine.close();
  }
});

test('limits refuse incomplete catalogue searches and revoked ownership/Active block replies', async () => {
  const x = await harness();
  try {
    const job = await x.ask('ค้นงานที่ยังค้าง');
    x.h.tables.tasks[0].fields.Agent = [x.h.other.id];
    await assert.rejects(x.send(job.ticket, JSON.stringify({ taskIds: [rid(11)] })));
    x.h.tables.tasks[0].fields.Agent = [x.h.agent.id];
    const active = await x.ask('ค้นงานที่ยังค้าง');
    x.h.tables.users[1].fields.Active = false;
    await assert.rejects(x.send(active.ticket, JSON.stringify({ taskIds: [rid(11)] })));
    x.h.tables.users[1].fields.Active = true;
    for (let i = 100; i < 350; i++)
      x.h.tables.tasks.push({
        id: rid(i),
        fields: { ...x.h.tables.tasks[0].fields, 'Task ID': `HVR-${i}` },
      });
    const limited = await x.ask('ค้นงานที่ยังค้าง');
    assert.equal(limited.needsAi, false);
    assert.equal(limited.taskSearch, undefined);
    await x.send(limited.ticket, 'MODEL SHOULD NOT RUN');
    assert.ok(x.sent[0].includes('จำกัดประเภท'));
    const data = await aiContext(x.db, c, x.h.repo, x.h.agent, 'HVR-00001');
    data.context.items[0].title = 'x'.repeat(61000);
    assert.equal(taskSearchContext(data).limited, true);
  } finally {
    await x.engine.close();
  }
});
