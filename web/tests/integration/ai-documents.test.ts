import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { database, repository, config } from '../fixtures';
import {
  createDocument,
  publishDocument,
  pauseDocument,
  favoriteDocument,
  saveDocumentDraft,
} from '../../src/server/documents/service';
import { receiveAi, replyAi } from '../../src/server/ai/line';
import { documentIntent, documentSearchPhrase } from '../../src/server/ai/documents';
import { documentInput } from '../../src/domain/documents';

const sender = 'U' + '1'.repeat(32),
  bot = 'U' + 'a'.repeat(32);
const c = {
  ...config,
  FORMS_ENABLED: true,
  AI_FORMS_ENABLED: true,
  AI_LINE_ENABLED: true,
  AI_LINE_CHANNEL_SECRET: 'document-test-secret',
  AI_LINE_CHANNEL_ACCESS_TOKEN: 'document-test-token',
  AI_LINE_OA_ID: '@test-documents',
  AI_LINE_BOT_USER_ID: bot,
};
const data = documentInput.parse({
  title: 'HC1',
  category: 'แบบฟอร์มทั่วไป',
  description: 'แบบฟอร์มรับรองสุขภาพ',
  keywords: ['HC1', 'ใบสุขภาพ'],
  audience: 'all',
  url: 'https://www.allianz.co.th/content/dam/forms/hc1.pdf',
  label: 'ฉบับตรวจ',
  effectiveDate: '',
  note: 'เพิ่มเอกสาร',
});
async function harness() {
  const { db, engine } = await database(),
    h = repository();
  const admin = { ...h.secretary, role: 'Admin' as const };
  await db.query(
    `INSERT INTO hvr_ai_accounts(environment,user_id,line_id,display_name) VALUES($1,$2,$3,'test')`,
    [c.APP_ENV, h.agent.id, sender],
  );
  const create = async (title: string, audience = 'all', publish = true) => {
    const d = await createDocument(db, c, admin, randomUUID(), {
      ...data,
      title,
      audience,
      keywords: [title, 'สุขภาพ'],
    });
    if (publish) await publishDocument(db, c, admin, d.id, 1, d.versionId, true);
    return d;
  };
  const ask = async (text: string) => {
    const raw = JSON.stringify({
      destination: bot,
      events: [
        {
          webhookEventId: randomUUID(),
          type: 'message',
          timestamp: Date.now(),
          source: { type: 'user', userId: sender },
          replyToken: 'test',
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
  const sent: string[] = [];
  const transport: typeof fetch = async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)).messages[0].text);
    return Response.json({});
  };
  return { db, engine, h, admin, create, ask, sent, transport };
}
test('document intent distinguishes task commands and supports Thai aliases', () => {
  for (const q of ['ขอฟอร์ม HC1', 'มีเอกสารหักบัญชีไหม', 'เอกสารยูนิตลิงค์มีอะไรบ้าง', 'ขอเอกสารที่ฉันติดดาวไว้'])
    assert.ok(documentIntent(q), q);
  for (const q of ['ส่งงาน ขอเอกสารลูกค้า', 'ยืนยันสร้างงาน', 'ยกเลิก', 'สถานะงานเอกสาร HVR-00001'])
    assert.equal(documentIntent(q), false, q);
  assert.equal(documentSearchPhrase('มีเอกสารหักบัญชีไหม'), 'หักบัญชี');
  assert.equal(documentSearchPhrase('เอกสารยูนิตลิงค์มีอะไรบ้าง'), 'ยูนิต ลิงค์');
});
test('document-only questions never list tasks; untrusted model links/IDs are ignored; single-use reply persists ordered refs', async () => {
  const x = await harness();
  try {
    const first = await x.create('HC1'),
      second = await x.create('HC2');
    await x.create('HC1 staff', 'staff');
    await x.create('HC1 draft', 'all', false);
    const list = x.h.repo.list;
    let taskReads = 0;
    x.h.repo.list = async (...args) => {
      if (args[0] === 'tasks') taskReads++;
      return list(...args);
    };
    const job = await x.ask('ขอเอกสารสุขภาพ');
    assert.equal(job.documents?.items.length, 2);
    assert.equal(job.context, undefined);
    assert.equal(taskReads, 0);
    assert.ok(!JSON.stringify(job).includes('staff'));
    assert.ok(!JSON.stringify(job).includes('draft'));
    const order = [second.id, first.id];
    await replyAi(
      x.db,
      c,
      x.h.repo,
      job.ticket,
      JSON.stringify({ documentIds: order }),
      x.transport,
    );
    assert.ok(x.sent[0].indexOf('HC2') < x.sent[0].indexOf('HC1'));
    const followup = await x.ask('ขอลิงก์รายการที่สอง');
    assert.equal(followup.documents?.items[0].id, first.id);
    await replyAi(
      x.db,
      c,
      x.h.repo,
      followup.ticket,
      JSON.stringify({ documentIds: [randomUUID()], taskAnswer: 'https://evil.test' }),
      x.transport,
    );
    assert.ok(!x.sent[1].includes('evil.test'));
    assert.ok(x.sent[1].includes(`/forms/${first.id}/open`));
    await assert.rejects(replyAi(x.db, c, x.h.repo, followup.ticket, '', x.transport));
    assert.equal(x.sent.length, 2);
    assert.equal(taskReads, 0);
  } finally {
    await x.engine.close();
  }
});
test('favorites are per user and documents cannot change an in-progress task draft', async () => {
  const x = await harness();
  try {
    const a = await x.create('HC1'),
      b = await x.create('HC2');
    await favoriteDocument(x.db, c, x.h.agent, a.id, true);
    await favoriteDocument(x.db, c, x.h.other, b.id, true);
    const taskDraft = await x.ask('ส่งงาน ติดตามลูกค้า');
    assert.ok(taskDraft.draft);
    const before = (await x.db.query('SELECT revision,fields,state FROM hvr_ai_drafts')).rows;
    const docs = await x.ask('ขอเอกสารที่ฉันติดดาวไว้');
    assert.deepEqual(
      docs.documents?.items.map((i) => i.id),
      [a.id],
    );
    assert.equal(docs.draft, undefined);
    assert.deepEqual(
      (await x.db.query('SELECT revision,fields,state FROM hvr_ai_drafts')).rows,
      before,
    );
    await replyAi(x.db, c, x.h.repo, docs.ticket, '', x.transport);
    const summary = await x.ask('สรุปงานวันนี้');
    assert.ok(summary.context?.totals);
  } finally {
    await x.engine.close();
  }
});
test('pause/publication while generating uses current access and removes stale document memory', async () => {
  const x = await harness();
  try {
    const a = await x.create('HC1');
    const job = await x.ask('ขอฟอร์ม HC1');
    await pauseDocument(x.db, c, x.admin, a.id, 2, true);
    await replyAi(
      x.db,
      c,
      x.h.repo,
      job.ticket,
      JSON.stringify({ documentIds: [a.id] }),
      x.transport,
    );
    assert.ok(!x.sent[0].includes('HC1'));
    assert.ok(!x.sent[0].includes(a.id));
    await pauseDocument(x.db, c, x.admin, a.id, 3, false);
    const job2 = await x.ask('ขอฟอร์ม HC1');
    const next = await saveDocumentDraft(x.db, c, x.admin, a.id, 4, null, {
      ...data,
      title: 'HC1 ฉบับใหม่',
    });
    await publishDocument(x.db, c, x.admin, a.id, next.revision, next.versionId, true);
    await replyAi(
      x.db,
      c,
      x.h.repo,
      job2.ticket,
      JSON.stringify({ documentIds: [a.id] }),
      x.transport,
    );
    assert.ok(x.sent[1].includes('HC1 ฉบับใหม่'));
    const last = (
      await x.db.query(
        'SELECT document_refs FROM hvr_ai_memory_turns WHERE answer IS NOT NULL ORDER BY id DESC LIMIT 1',
      )
    ).rows[0];
    assert.equal(last.document_refs[0].versionId, next.versionId);
    const third = await x.ask('ขอฟอร์ม HC1');
    await x.ask('ล้างความจำ');
    await assert.rejects(replyAi(x.db, c, x.h.repo, third.ticket, '', x.transport));
    assert.equal(x.sent.length, 2);
  } finally {
    await x.engine.close();
  }
});
test('revoked Active and mixed questions retain existing task ownership checks', async () => {
  const x = await harness();
  try {
    await x.create('HC1');
    const job = await x.ask('สถานะ HVR-00001 และขอฟอร์ม HC1');
    assert.ok(job.context?.items.every((t) => t.code !== 'HVR-00002'));
    assert.equal(job.documents?.mixed, true);
    const account = x.h.tables.users.find((r) => r.id === x.h.agent.id);
    assert.ok(account);
    account.fields.Active = false;
    await assert.rejects(replyAi(x.db, c, x.h.repo, job.ticket, '', x.transport));
    assert.equal(x.sent.length, 0);
  } finally {
    await x.engine.close();
  }
});
