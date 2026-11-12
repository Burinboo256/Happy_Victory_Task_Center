import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { config, migrationSql, repository } from '../fixtures';
import {
  createDocument,
  saveDocumentDraft,
  publishDocument,
  favoriteDocument,
  publishedDocument,
} from '../../src/server/documents/service';
import { AppError } from '../../src/server/errors';

test('PostgreSQL serializes concurrent creation and publication without duplicate versions or favorites', async () => {
  const raw = process.env.TEST_DATABASE_URL;
  assert.ok(raw);
  assert.match(new URL(raw).pathname, /test/i);
  assert.notEqual(raw, process.env.DATABASE_URL);
  const schema = 'hvr_test_' + randomUUID().replaceAll('-', '');
  const control = new Pool({ connectionString: raw, max: 1 });
  const db = new Pool({ connectionString: raw, max: 5, options: '-c search_path=' + schema });
  try {
    await control.query('CREATE SCHEMA ' + schema);
    for (const sql of await migrationSql()) await db.query(sql);
    const c = { ...config, FORMS_ENABLED: true },
      h = repository(),
      admin = { ...h.secretary, role: 'Admin' as const };
    await db.query('INSERT INTO hvr_instances(environment,base_id) VALUES($1,$2)', [
      c.APP_ENV,
      c.AIRTABLE_BASE_ID,
    ]);
    const id = randomUUID(),
      data = {
        title: 'Concurrent form',
        category: 'เอกสารทีม',
        description: '',
        keywords: [],
        audience: 'all',
        url: 'https://drive.google.com/file/d/synthetic/view',
        label: '1',
        effectiveDate: '',
        note: 'test',
      };
    const drafts = await Promise.all(
      Array.from({ length: 5 }, () => createDocument(db, c, admin, id, data)),
    );
    assert.equal(new Set(drafts.map((d) => d.versionId)).size, 1);
    const first = drafts[0];
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => publishDocument(db, c, admin, id, 1, first.versionId, true)),
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    for (const r of results)
      if (r.status === 'rejected')
        assert.ok(r.reason instanceof AppError && r.reason.code === 'DOCUMENT_CHANGED');
    await Promise.all(Array.from({ length: 5 }, () => favoriteDocument(db, c, h.agent, id, true)));
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM hvr_document_favorites')).rows[0].n,
      1,
    );
    const second = await saveDocumentDraft(db, c, admin, id, 2, null, { ...data, label: '2' });
    const third = await saveDocumentDraft(db, c, admin, id, second.revision, null, {
      ...data,
      label: '3',
    });
    const competing = await Promise.allSettled(
      [second, third].map((v) =>
        publishDocument(db, c, admin, id, third.revision, v.versionId, true),
      ),
    );
    assert.equal(competing.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM hvr_document_versions WHERE status='published'",
        )
      ).rows[0].n,
      1,
    );
    assert.equal((await publishedDocument(db, c, h.agent, id)).favorite, true);
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM hvr_document_events WHERE action='publish'"))
        .rows[0].n,
      2,
    );
  } finally {
    await db.end();
    if (/^hvr_test_[a-f0-9]{32}$/.test(schema))
      await control.query('DROP SCHEMA ' + schema + ' CASCADE');
    await control.end();
  }
});
