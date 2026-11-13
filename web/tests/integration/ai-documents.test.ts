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
  assert.equal(
    documentSearchPhrase('ขอฟอร์มมอบอำนาจ ตัวแทน ยูนิตลิงค์'),
    'มอบอำนาจ ตัวแทน ยูนิต ลิงค์'.normalize('NFKC'),
  );
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

test('natural-language search gives AI authorized metadata and remembers only selected results', async () => {
  const x = await harness();
  try {
    const consent = await x.create('หนังสือให้เปิดเผยประวัติการรักษาและการมอบอำนาจ');
    const linked = await x.create('หนังสือให้เปิดเผยประวัติการรักษาและการมอบอำนาจ ยูนิต ลิงค์');
    await x.create('HC1');
    const staff = await x.create('มอบอำนาจภายใน', 'staff');
    const draft = await x.create('มอบอำนาจฉบับร่าง', 'all', false);
    const paused = await x.create('มอบอำนาจพักใช้');
    await pauseDocument(x.db, c, x.admin, paused.id, 2, true);
    const list = x.h.repo.list;
    let taskReads = 0;
    x.h.repo.list = async (...args) => {
      if (args[0] === 'tasks') taskReads++;
      return list(...args);
    };
    const job = await x.ask('มีฟอร์มเกี่ยวกับ มอบอำนาจ ตัวแทนไหม');
    assert.equal(job.documents?.selection, 'semantic');
    assert.equal(job.documents?.query, 'มอบอำนาจ ตัวแทน'.normalize('NFKC'));
    assert.equal(job.documents?.items.length, 3);
    assert.ok(job.documents?.items.every((d) => Array.isArray(d.keywords)));
    assert.equal(taskReads, 0);
    for (const excluded of [staff.id, draft.id, paused.id])
      assert.ok(!JSON.stringify(job).includes(excluded));
    assert.ok(!JSON.stringify(job.documents).includes('https://'));
    assert.deepEqual(
      (await x.db.query('SELECT document_refs FROM hvr_ai_memory_turns')).rows[0].document_refs,
      [],
    );
    await replyAi(
      x.db,
      c,
      x.h.repo,
      job.ticket,
      JSON.stringify({ documentIds: [linked.id, consent.id] }),
      x.transport,
    );
    assert.ok(x.sent[0].includes('อาจเกี่ยวข้อง'));
    assert.ok(x.sent[0].includes('ยังไม่ได้อ่านเนื้อหาไฟล์'));
    assert.ok(!x.sent[0].includes('HC1'));
    assert.ok(!x.sent[0].includes('จาก 3 รายการ'));
    const refs = (await x.db.query('SELECT document_refs FROM hvr_ai_memory_turns')).rows[0]
      .document_refs;
    assert.deepEqual(
      refs.map((r: { id: string }) => r.id),
      [linked.id, consent.id],
    );
    const followup = await x.ask('ขอลิงก์รายการที่สอง');
    assert.equal(followup.documents?.selection, 'keyword');
    assert.equal(followup.documents?.items[0].id, consent.id);
  } finally {
    await x.engine.close();
  }
});

test('semantic failures, empty selections and invented IDs never display the candidate catalogue', async () => {
  const x = await harness();
  try {
    const a = await x.create('HC1');
    for (const response of [
      '',
      'https://evil.test/document.pdf',
      JSON.stringify({ documentIds: [] }),
      JSON.stringify({ documentIds: [randomUUID()] }),
      JSON.stringify({ documentIds: [a.id], url: 'https://evil.test' }),
    ]) {
      const job = await x.ask('ขอฟอร์มให้คนอื่นดำเนินการแทน');
      assert.equal(job.documents?.selection, 'semantic');
      await replyAi(x.db, c, x.h.repo, job.ticket, response, x.transport);
      const answer = x.sent.at(-1);
      assert.ok(answer);
      assert.ok(!answer.includes('HC1'));
      assert.ok(!answer.includes(a.id));
      assert.ok(!answer.includes('evil.test'));
      assert.ok(answer.includes('เพิ่มเติม'));
    }
    const memories = (await x.db.query('SELECT document_refs FROM hvr_ai_memory_turns')).rows;
    assert.ok(memories.every((r) => r.document_refs.length === 0));
  } finally {
    await x.engine.close();
  }
});

test('semantic selections recheck access and do not reuse model relevance for a changed version', async () => {
  const x = await harness();
  try {
    const a = await x.create('มอบอำนาจ');
    const b = await x.create('ใบยินยอม');
    const job = await x.ask('ขอฟอร์มให้คนอื่นดำเนินการแทน');
    assert.equal(job.documents?.selection, 'semantic');
    const next = await saveDocumentDraft(x.db, c, x.admin, a.id, 2, null, {
      ...data,
      title: 'เอกสารเปลี่ยนวัตถุประสงค์',
    });
    await publishDocument(x.db, c, x.admin, a.id, next.revision, next.versionId, true);
    await pauseDocument(x.db, c, x.admin, b.id, 2, true);
    await replyAi(
      x.db,
      c,
      x.h.repo,
      job.ticket,
      JSON.stringify({ documentIds: [a.id, b.id] }),
      x.transport,
    );
    assert.ok(!x.sent[0].includes(a.id));
    assert.ok(!x.sent[0].includes(b.id));
    assert.ok(x.sent[0].includes('ลองอีกครั้ง'));
  } finally {
    await x.engine.close();
  }
});

test('exact codes and empty favorites never broaden into semantic candidates', async () => {
  const x = await harness();
  try {
    await x.create('HC1');
    for (const question of ['ขอฟอร์ม HC99', 'รายการโปรด', 'ขอเอกสารที่ฉันติดดาวไว้']) {
      const job = await x.ask(question);
      assert.equal(job.documents?.selection, 'keyword');
      assert.equal(job.documents?.items.length, 0);
    }
    const exact = await x.ask('ขอฟอร์ม HC1');
    assert.equal(exact.documents?.selection, 'keyword');
    assert.equal(exact.documents?.items.length, 1);
    await replyAi(
      x.db,
      c,
      x.h.repo,
      exact.ticket,
      JSON.stringify({ documentIds: [] }),
      x.transport,
    );
    assert.ok(!x.sent[0].includes('เปิดเอกสาร:'));
  } finally {
    await x.engine.close();
  }
});

test('larger catalogues ask for a narrower query instead of silently searching a truncated list', async () => {
  const x = await harness();
  try {
    for (let i = 0; i < 101; i++) await x.create(`เอกสารลำดับ ${i}`);
    const job = await x.ask('ขอฟอร์มให้คนอื่นดำเนินการแทน');
    assert.equal(job.documents?.searchLimited, true);
    assert.equal(job.documents?.items.length, 0);
    await replyAi(x.db, c, x.h.repo, job.ticket, '', x.transport);
    assert.ok(x.sent[0].includes('ละเอียดขึ้น'));
    assert.ok(!x.sent[0].includes('เอกสารลำดับ'));
  } finally {
    await x.engine.close();
  }
});
