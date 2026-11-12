import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, repository, config } from '../fixtures';
import {
  createDocument,
  saveDocumentDraft,
  publishDocument,
  pauseDocument,
  favoriteDocument,
  listDocuments,
  documentDetails,
  publishedDocument,
} from '../../src/server/documents/service';
import { AppError } from '../../src/server/errors';
import { catalogueRows, importCatalogue } from '../../src/server/documents/import';
const c = { ...config, FORMS_ENABLED: true };
const data = {
  title: 'HC1',
  category: 'แบบฟอร์มทั่วไป',
  description: 'แบบฟอร์มรับรองสุขภาพ',
  keywords: ['ใบสุขภาพ'],
  audience: 'all',
  url: 'https://www.allianz.co.th/content/dam/forms/hc1.pdf',
  label: 'ฉบับแรก',
  effectiveDate: '',
  note: 'เพิ่มเอกสาร',
};
const code = (expected: string) => (e: unknown) => e instanceof AppError && e.code === expected;

test('catalogue imports 43 drafts idempotently without replacing an edited document', async () => {
  const { db, engine } = await database();
  const h = repository(),
    admin = { ...h.secretary, role: 'Admin' as const };
  try {
    assert.equal(catalogueRows().length, 43);
    assert.equal(catalogueRows().filter((d) => d.needsLinkReview).length, 3);
    assert.equal((await importCatalogue(db, c, admin)).created.length, 43);
    assert.equal((await listDocuments(db, c, h.agent, {})).total, 0);
    const entry = (await listDocuments(db, c, admin, { tab: 'drafts' })).items[0];
    await saveDocumentDraft(db, c, admin, entry.id, entry.revision, entry.version.id, {
      ...entry.version.data,
      title: 'ชื่อที่ Admin ตรวจแก้แล้ว',
    });
    assert.equal((await importCatalogue(db, c, admin)).skipped, 43);
    assert.equal(
      (await documentDetails(db, c, admin, entry.id)).document.version.data.title,
      'ชื่อที่ Admin ตรวจแก้แล้ว',
    );
    assert.equal((await db.query('SELECT count(*)::int AS n FROM hvr_documents')).rows[0].n, 43);
  } finally {
    await engine.close();
  }
});

test('secretary drafts are private; only admin publishes; favorites and versions follow current access', async () => {
  const { db, engine } = await database();
  const h = repository();
  const admin = { ...h.secretary, id: 'admin-test', role: 'Admin' as const };
  const secretaryB = { ...h.secretary, id: 'secretary-b' };
  try {
    const id = randomUUID();
    await assert.rejects(createDocument(db, c, h.agent, id, data), code('FORBIDDEN'));
    await assert.rejects(
      createDocument(db, c, { ...h.secretary, active: false }, id, data),
      code('FORBIDDEN'),
    );
    const draft = await createDocument(db, c, h.secretary, id, data);
    assert.deepEqual(await createDocument(db, c, h.secretary, id, data), draft);
    assert.equal((await listDocuments(db, c, h.agent, {})).total, 0);
    assert.equal((await listDocuments(db, c, secretaryB, { tab: 'drafts' })).total, 0);
    await assert.rejects(documentDetails(db, c, h.agent, id), code('DOCUMENT_NOT_FOUND'));
    await assert.rejects(
      saveDocumentDraft(db, c, secretaryB, id, 1, draft.versionId, data),
      code('FORBIDDEN'),
    );
    await assert.rejects(
      publishDocument(db, c, h.secretary, id, 1, draft.versionId, true),
      code('FORBIDDEN'),
    );
    const edited = await saveDocumentDraft(db, c, h.secretary, id, 1, draft.versionId, {
      ...data,
      title: 'HC1 แก้ร่าง',
    });
    await assert.rejects(
      publishDocument(db, c, admin, id, 1, draft.versionId, true),
      code('DOCUMENT_CHANGED'),
    );
    await assert.rejects(
      publishDocument(db, c, admin, id, edited.revision, draft.versionId, false),
      code('DOCUMENT_REVIEW'),
    );
    await publishDocument(db, c, admin, id, edited.revision, draft.versionId, true);
    assert.equal((await listDocuments(db, c, h.agent, { q: 'ใบสุขภาพ' })).total, 1);
    await favoriteDocument(db, c, h.agent, id, true);
    await favoriteDocument(db, c, h.agent, id, true);
    assert.equal((await listDocuments(db, c, h.agent, { tab: 'favorites' })).total, 1);
    assert.equal((await listDocuments(db, c, h.other, { tab: 'favorites' })).total, 0);
    const next = await saveDocumentDraft(db, c, admin, id, 3, null, {
      ...data,
      audience: 'staff',
      title: 'HC1 สำหรับทีม',
      url: 'https://drive.google.com/file/d/new-file/view',
    });
    assert.equal((await publishedDocument(db, c, h.agent, id)).version.data.title, 'HC1 แก้ร่าง');
    assert.equal((await documentDetails(db, c, h.agent, id)).versions.length, 1);
    await publishDocument(db, c, admin, id, next.revision, next.versionId, true);
    await assert.rejects(publishedDocument(db, c, h.agent, id), code('DOCUMENT_NOT_FOUND'));
    assert.equal((await listDocuments(db, c, h.agent, { tab: 'favorites' })).total, 0);
    assert.equal((await publishedDocument(db, c, h.secretary, id)).version.source, 'drive');
    assert.equal((await documentDetails(db, c, admin, id)).versions.length, 2);
    await pauseDocument(db, c, admin, id, 5, true);
    await assert.rejects(publishedDocument(db, c, h.secretary, id), code('DOCUMENT_NOT_FOUND'));
    await assert.rejects(
      favoriteDocument(db, c, h.secretary, id, true),
      code('DOCUMENT_NOT_FOUND'),
    );
    await pauseDocument(db, c, admin, id, 6, false);
    assert.ok(await publishedDocument(db, c, h.secretary, id));
    assert.equal(
      (await db.query('SELECT * FROM hvr_document_events WHERE document_id=$1', [id])).rows.length,
      7,
    );
    assert.equal((await listDocuments(db, { ...c, APP_ENV: 'staging' }, admin, {})).total, 0);
    await assert.rejects(
      listDocuments(db, { ...c, FORMS_ENABLED: false }, admin, {}),
      code('FORMS_DISABLED'),
    );
  } finally {
    await engine.close();
  }
});

test('query searches all pages; failed publication leaves current version and revision intact', async () => {
  const { db, engine } = await database();
  const h = repository();
  const admin = { ...h.secretary, role: 'Admin' as const };
  try {
    for (let i = 0; i < 12; i++) {
      const created = await createDocument(db, c, admin, randomUUID(), {
        ...data,
        title: `เอกสาร ${String(i).padStart(2, '0')}`,
      });
      await publishDocument(db, c, admin, created.id, 1, created.versionId, true);
    }
    const page = await listDocuments(db, c, h.agent, { page: 2 });
    assert.equal(page.items.length, 2);
    assert.equal(page.total, 12);
    assert.equal((await listDocuments(db, c, h.agent, { q: 'เอกสาร 11' })).total, 1);
    const current = page.items[0];
    await assert.rejects(
      publishDocument(db, c, admin, current.id, current.revision, randomUUID(), true),
      code('DOCUMENT_CHANGED'),
    );
    assert.equal((await publishedDocument(db, c, h.agent, current.id)).revision, current.revision);
  } finally {
    await engine.close();
  }
});
