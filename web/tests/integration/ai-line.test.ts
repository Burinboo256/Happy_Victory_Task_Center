import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { database, repository, config, rid } from '../fixtures';
import { aiContext } from '../../src/server/ai/context';
import {
  startAiLink,
  confirmAiLink,
  receiveAi,
  replyAi,
  disconnectAi,
} from '../../src/server/ai/line';
import { newCaseState } from '../../src/domain/case-workflow';
const sender = 'U' + '1'.repeat(32),
  bot = 'U' + 'a'.repeat(32);
const c = {
  ...config,
  AI_LINE_ENABLED: true,
  AI_LINE_CHANNEL_SECRET: 'ai-test-secret-not-live',
  AI_LINE_CHANNEL_ACCESS_TOKEN: 'ai-test-token-not-live',
  AI_LINE_OA_ID: '@test-ai',
  AI_LINE_BOT_USER_ID: bot,
};
const profile: typeof fetch = async () =>
  Response.json({ userId: sender, displayName: 'Test LINE' });
function event(text: string, extra: Record<string, unknown> = {}) {
  return {
    destination: bot,
    events: [
      {
        webhookEventId: randomUUID(),
        type: 'message',
        timestamp: Date.now(),
        source: { type: 'user', userId: sender },
        replyToken: 'test-reply-only',
        message: { type: 'text', text },
        ...extra,
      },
    ],
  };
}
const signed = (body: unknown) => {
  const raw = JSON.stringify(body);
  return [
    raw,
    createHmac('sha256', c.AI_LINE_CHANNEL_SECRET).update(raw).digest('base64'),
  ] as const;
};

test('AI link requires fresh signed direct message and browser confirmation; old OA grants nothing', async () => {
  const { db, engine } = await database(),
    h = repository();
  try {
    const [raw, signature] = signed(event('hello'));
    await assert.rejects(receiveAi(db, c, h.repo, raw + ' ', signature));
    await assert.rejects(
      receiveAi(db, c, h.repo, ...signed({ ...event('hello'), destination: 'U' + 'b'.repeat(32) })),
    );
    assert.equal(
      (
        await receiveAi(
          db,
          c,
          h.repo,
          ...signed(event('hello', { source: { type: 'group', userId: sender } })),
        )
      ).jobs.length,
      0,
    );
    assert.equal(
      (
        await receiveAi(
          db,
          c,
          h.repo,
          ...signed(event('hello', { timestamp: Date.now() - 180000 })),
        )
      ).jobs.length,
      0,
    );
    const { code } = await startAiLink(db, c, h.agent);
    const payload = event(code);
    const result = await receiveAi(db, c, h.repo, ...signed(payload));
    assert.equal(result.jobs[0].needsAi, false);
    assert.equal((await receiveAi(db, c, h.repo, ...signed(payload))).jobs.length, 0);
    assert.equal((await db.query('SELECT * FROM hvr_ai_accounts')).rows.length, 0);
    await confirmAiLink(db, c, h.agent, sender, profile);
    await assert.rejects(confirmAiLink(db, c, h.other, sender, profile));
    assert.equal((await db.query('SELECT * FROM hvr_line_accounts')).rows.length, 0);
    const answer = await receiveAi(db, c, h.repo, ...signed(event('สรุปงานวันนี้')));
    assert.equal(answer.jobs[0].context?.totals.all, 1);
    assert.equal(answer.jobs[0].context?.items[0].code, 'HVR-00001');
    assert.ok(!JSON.stringify(answer).includes('HVR-00002'));
    await disconnectAi(db, c, h.agent);
    const unlinked = await receiveAi(db, c, h.repo, ...signed(event('สรุปงานวันนี้')));
    assert.equal(unlinked.jobs[0].needsAi, false);
  } finally {
    await engine.close();
  }
});
test('AI uses safe projections and workflow progress, never case fields, descriptions or internal notes', async () => {
  const { db, engine } = await database(),
    h = repository();
  try {
    h.tables.tasks[0].fields.Category = 'ตัวแทนใหม่';
    h.tables.tasks[0].fields.Description = 'PRIVATE_DESCRIPTION';
    const state = newCaseState('ตัวแทนใหม่');
    state.fields.agentCode = 'PRIVATE_AGENT_CODE';
    const first = Object.keys(state.items)[0];
    state.items[first].notes = 'PRIVATE_NOTES';
    state.items[first].followupDate = '2026-11-12';
    await db.query(
      'INSERT INTO hvr_workflows(environment,resource,version,payload,operation_key) VALUES($1,$2,1,$3::jsonb,gen_random_uuid())',
      [c.APP_ENV, 'case:' + rid(11), JSON.stringify(state)],
    );
    const agent = await aiContext(db, c, h.repo, h.agent, 'สรุปงาน');
    const manager = await aiContext(db, c, h.repo, h.secretary, 'สรุปงาน');
    assert.equal(agent.context.totals.all, 1);
    assert.equal(manager.context.totals.all, 2);
    assert.equal(agent.context.items[0].workflow?.pending, undefined);
    assert.equal(
      manager.context.items.find((t) => t.code === 'HVR-00001')?.workflow?.pending?.length,
      1,
    );
    assert.ok(!JSON.stringify(manager).includes('PRIVATE_'));
    assert.equal((await aiContext(db, c, h.repo, h.agent, 'สถานะ HVR-00002')).context.matched, 0);
    assert.ok(!h.calls.some((x) => x.startsWith('patch:') || x.startsWith('upsert:')));
  } finally {
    await engine.close();
  }
});
test('AI reply is single-use, fixed-recipient, and rechecks Active, binding, role and ownership before sending', async () => {
  const { db, engine } = await database(),
    h = repository();
  let sends = 0;
  const transport: typeof fetch = async (_url, init) => {
    sends++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.replyToken, 'test-reply-only');
    assert.equal(body.to, undefined);
    return Response.json({});
  };
  try {
    await db.query(
      'INSERT INTO hvr_ai_accounts(environment,user_id,line_id,display_name) VALUES($1,$2,$3,$4)',
      [c.APP_ENV, h.agent.id, sender, 'Test'],
    );
    const ask = async () => (await receiveAi(db, c, h.repo, ...signed(event('สรุปวันนี้')))).jobs[0];
    let job = await ask();
    await replyAi(db, c, h.repo, job.ticket, 'สรุปทดสอบ', transport);
    await assert.rejects(replyAi(db, c, h.repo, job.ticket, 'ส่งซ้ำ', transport));
    assert.equal(sends, 1);
    job = await ask();
    h.tables.tasks[0].fields.Agent = [h.other.id];
    await assert.rejects(replyAi(db, c, h.repo, job.ticket, 'ข้อมูลเจ้าของเดิม', transport));
    h.tables.tasks[0].fields.Agent = [h.agent.id];
    job = await ask();
    h.tables.users[1].fields.Active = false;
    await assert.rejects(replyAi(db, c, h.repo, job.ticket, 'บัญชีปิด', transport));
    h.tables.users[1].fields.Active = true;
    job = await ask();
    await disconnectAi(db, c, h.agent);
    await assert.rejects(replyAi(db, c, h.repo, job.ticket, 'ยกเลิกแล้ว', transport));
    assert.equal(sends, 1);
    const direct = await ask();
    let sent = '';
    await replyAi(db, c, h.repo, direct.ticket, 'ATTACK_REPLACE_LINK', async (_u, init) => {
      sent = String(init?.body);
      return Response.json({});
    });
    assert.ok(!sent.includes('ATTACK_REPLACE_LINK'));
    assert.ok(sent.includes('/notifications'));
  } finally {
    await engine.close();
  }
});
