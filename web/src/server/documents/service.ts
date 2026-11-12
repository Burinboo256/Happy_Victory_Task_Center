import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { User } from '../../domain/model';
import {
  documentInput,
  documentLink,
  documentQuery,
  documentScore,
  type DocumentEntry,
  type DocumentInput,
  type DocumentList,
  type DocumentVersion,
} from '../../domain/documents';
import type { Config } from '../config';
import { atomic, type Sql } from '../db';
import { AppError, forbidden } from '../errors';

export function requireForms(c: Config, user: User) {
  if (!c.FORMS_ENABLED) throw new AppError(404, 'FORMS_DISABLED', 'คลังเอกสารยังไม่เปิดใช้งาน');
  if (!user.active || !['Agent', 'Secretary', 'Admin'].includes(user.role)) throw forbidden();
}
const missing = () =>
  new AppError(404, 'DOCUMENT_NOT_FOUND', 'ไม่พบเอกสารที่มีสิทธิ์เข้าถึง หรือเอกสารถูกพักใช้');
const conflict = () =>
  new AppError(409, 'DOCUMENT_CHANGED', 'เอกสารถูกแก้ไขแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึก');
const idSchema = z.uuid();
type Row = {
  id: string;
  document_id: string;
  revision: number;
  document_status: 'active' | 'paused';
  current_version: string | null;
  favorite: boolean;
  created_by: string;
  status: DocumentVersion['status'];
  payload: DocumentInput;
  reviewed_at: Date | string | null;
  reviewed_by: string | null;
};
function entry(row: Row): DocumentEntry {
  const data = documentInput.parse(row.payload);
  const link = documentLink(data.url);
  if (!link) throw missing();
  return {
    id: row.document_id,
    revision: row.revision,
    status: row.document_status,
    currentId: row.current_version,
    favorite: row.favorite,
    version: {
      id: row.id,
      documentId: row.document_id,
      status: row.status,
      createdBy: row.created_by,
      reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
      reviewedBy: row.reviewed_by,
      source: link.source,
      data,
    },
  };
}
async function visibleVersions(db: Sql, c: Config, user: User, id?: string) {
  requireForms(c, user);
  if (id) idSchema.parse(id);
  // Only Admin sees archived history. Secretaries see their own drafts plus current shared versions.
  return (
    await db.query<Row>(
      `SELECT v.*, d.revision,d.status AS document_status,d.current_version,
      EXISTS(SELECT 1 FROM hvr_document_favorites f WHERE f.environment=d.environment AND f.document_id=d.id AND f.user_id=$3) AS favorite
    FROM hvr_documents d JOIN hvr_document_versions v ON v.environment=d.environment AND v.document_id=d.id
    WHERE d.environment=$1 AND ($4::uuid IS NULL OR d.id=$4) AND (
      $2='Admin' OR
      (v.id=d.current_version AND v.status='published' AND d.status='active' AND (v.payload->>'audience'='all' OR $2='Secretary')) OR
      ($2='Secretary' AND v.status='draft' AND v.created_by=$3)
    ) ORDER BY d.created_at DESC,v.created_at DESC,v.id`,
      [c.APP_ENV, user.role, user.id, id || null],
    )
  ).rows.map(entry);
}
export async function listDocuments(
  db: Sql,
  c: Config,
  user: User,
  input: unknown,
): Promise<DocumentList> {
  const query = documentQuery.parse(input);
  const versions = await visibleVersions(db, c, user);
  const published = versions.filter(
    (d) =>
      d.status === 'active' && d.currentId === d.version.id && d.version.status === 'published',
  );
  const drafts = versions.filter((d) => d.version.status === 'draft');
  const paused = versions.filter((d) => d.status === 'paused' && d.currentId === d.version.id);
  const favorites = published.filter((d) => d.favorite);
  const sets = { published, favorites, drafts, paused };
  const matched = sets[query.tab]
    .map((d) => ({ d, score: documentScore(d.version.data, query.q) }))
    .filter(
      ({ d, score }) =>
        score > 0 && (!query.category || d.version.data.category === query.category),
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.d.version.data.title.localeCompare(b.d.version.data.title, 'th') ||
        a.d.id.localeCompare(b.d.id),
    )
    .map(({ d }) => d);
  const pages = Math.max(1, Math.ceil(matched.length / 10));
  const page = Math.min(query.page, pages);
  return {
    items: matched.slice((page - 1) * 10, page * 10),
    total: matched.length,
    page,
    pages,
    counts: {
      published: published.length,
      favorites: favorites.length,
      drafts: drafts.length,
      paused: paused.length,
    },
  };
}
export async function documentDetails(db: Sql, c: Config, user: User, id: string) {
  const versions = await visibleVersions(db, c, user, id);
  if (!versions.length) throw missing();
  const current = versions.find((d) => d.version.id === d.currentId);
  return { document: current || versions[0], versions: versions.map((d) => d.version) };
}
export async function publishedDocument(db: Sql, c: Config, user: User, id: string) {
  const versions = await visibleVersions(db, c, user, id);
  const current = versions.find(
    (d) =>
      d.status === 'active' &&
      d.currentId === d.version.id &&
      d.version.status === 'published' &&
      (d.version.data.audience === 'all' || user.role !== 'Agent'),
  );
  if (!current) throw missing();
  return current;
}
export async function publishedDocuments(db: Sql, c: Config, user: User) {
  return (await visibleVersions(db, c, user)).filter(
    (d) =>
      d.status === 'active' &&
      d.currentId === d.version.id &&
      d.version.status === 'published' &&
      (d.version.data.audience === 'all' || user.role !== 'Agent'),
  );
}
async function audit(
  db: Sql,
  c: Config,
  user: User,
  id: string,
  action: string,
  before: number | null,
  after: number,
  versionId?: string,
  details = {},
) {
  await db.query(
    `INSERT INTO hvr_document_events(environment,document_id,actor_id,action,before_revision,after_revision,version_id,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [c.APP_ENV, id, user.id, action, before, after, versionId || null, JSON.stringify(details)],
  );
}
export async function createDocument(db: Sql, c: Config, user: User, id: string, value: unknown) {
  requireForms(c, user);
  if (user.role === 'Agent') throw forbidden();
  idSchema.parse(id);
  const payload = documentInput.parse(value);
  return atomic(db, async (tx) => {
    const created = await tx.query(
      `INSERT INTO hvr_documents(environment,id,created_by) VALUES($1,$2,$3) ON CONFLICT(environment,id) DO NOTHING RETURNING id`,
      [c.APP_ENV, id, user.id],
    );
    if (!created.rows.length) {
      const previous = await tx.query(
        `SELECT v.id,v.payload FROM hvr_documents d JOIN hvr_document_versions v ON v.environment=d.environment AND v.document_id=d.id WHERE d.environment=$1 AND d.id=$2 AND d.created_by=$3 AND d.revision=1 AND v.status='draft'`,
        [c.APP_ENV, id, user.id],
      );
      if (
        previous.rows.length === 1 &&
        JSON.stringify(documentInput.parse(previous.rows[0].payload)) === JSON.stringify(payload)
      )
        return { id, revision: 1, versionId: previous.rows[0].id as string };
      throw conflict();
    }
    const versionId = randomUUID();
    await tx.query(
      `INSERT INTO hvr_document_versions(environment,document_id,id,created_by,payload) VALUES($1,$2,$3,$4,$5::jsonb)`,
      [c.APP_ENV, id, versionId, user.id, JSON.stringify(payload)],
    );
    await audit(tx, c, user, id, 'create', null, 1, versionId);
    return { id, revision: 1, versionId };
  });
}
type Lock = {
  revision: number;
  current_version: string | null;
  created_by: string;
  status: string;
};
async function lock(db: Sql, c: Config, id: string, revision: number) {
  idSchema.parse(id);
  z.number().int().positive().parse(revision);
  const row = (
    await db.query<Lock>(
      'SELECT revision,current_version,created_by,status FROM hvr_documents WHERE environment=$1 AND id=$2 FOR UPDATE',
      [c.APP_ENV, id],
    )
  ).rows[0];
  if (!row) throw missing();
  if (row.revision !== revision) throw conflict();
  return row;
}
async function bump(db: Sql, c: Config, id: string) {
  await db.query(
    'UPDATE hvr_documents SET revision=revision+1,updated_at=clock_timestamp() WHERE environment=$1 AND id=$2',
    [c.APP_ENV, id],
  );
}
export async function saveDocumentDraft(
  db: Sql,
  c: Config,
  user: User,
  id: string,
  revision: number,
  versionId: string | null,
  value: unknown,
) {
  requireForms(c, user);
  if (user.role === 'Agent' || (!versionId && user.role !== 'Admin')) throw forbidden();
  if (versionId) idSchema.parse(versionId);
  const payload = documentInput.parse(value);
  return atomic(db, async (tx) => {
    await lock(tx, c, id, revision);
    const nextId = versionId || randomUUID();
    if (versionId) {
      const changed = await tx.query(
        `UPDATE hvr_document_versions SET payload=$5::jsonb,updated_at=clock_timestamp() WHERE environment=$1 AND document_id=$2 AND id=$3 AND status='draft' AND ($6 OR created_by=$4) RETURNING id`,
        [c.APP_ENV, id, versionId, user.id, JSON.stringify(payload), user.role === 'Admin'],
      );
      if (!changed.rows.length) throw forbidden();
    } else {
      await tx.query(
        `INSERT INTO hvr_document_versions(environment,document_id,id,created_by,payload) VALUES($1,$2,$3,$4,$5::jsonb)`,
        [c.APP_ENV, id, nextId, user.id, JSON.stringify(payload)],
      );
    }
    await bump(tx, c, id);
    await audit(
      tx,
      c,
      user,
      id,
      versionId ? 'edit_draft' : 'new_version',
      revision,
      revision + 1,
      nextId,
    );
    return { id, revision: revision + 1, versionId: nextId };
  });
}
export async function publishDocument(
  db: Sql,
  c: Config,
  user: User,
  id: string,
  revision: number,
  versionId: string,
  reviewed: boolean,
) {
  requireForms(c, user);
  if (user.role !== 'Admin') throw forbidden();
  if (!reviewed) throw new AppError(422, 'DOCUMENT_REVIEW', 'ต้องเปิดตรวจลิงก์ ผู้เห็น และข้อมูลก่อนเผยแพร่');
  idSchema.parse(versionId);
  return atomic(db, async (tx) => {
    await lock(tx, c, id, revision);
    const draft = (
      await tx.query(
        "SELECT payload FROM hvr_document_versions WHERE environment=$1 AND document_id=$2 AND id=$3 AND status='draft'",
        [c.APP_ENV, id, versionId],
      )
    ).rows[0];
    if (!draft) throw conflict();
    documentInput.parse(draft.payload);
    await tx.query(
      `UPDATE hvr_document_versions SET status='archived' WHERE environment=$1 AND document_id=$2 AND status='published'`,
      [c.APP_ENV, id],
    );
    await tx.query(
      `UPDATE hvr_document_versions SET status='published',reviewed_by=$4,reviewed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE environment=$1 AND document_id=$2 AND id=$3`,
      [c.APP_ENV, id, versionId, user.id],
    );
    await tx.query(
      `UPDATE hvr_documents SET current_version=$3,status='active' WHERE environment=$1 AND id=$2`,
      [c.APP_ENV, id, versionId],
    );
    await bump(tx, c, id);
    await audit(tx, c, user, id, 'publish', revision, revision + 1, versionId);
    return { id, revision: revision + 1 };
  });
}
export async function pauseDocument(
  db: Sql,
  c: Config,
  user: User,
  id: string,
  revision: number,
  paused: boolean,
) {
  requireForms(c, user);
  if (user.role !== 'Admin') throw forbidden();
  return atomic(db, async (tx) => {
    const row = await lock(tx, c, id, revision);
    if (!row.current_version) throw conflict();
    await tx.query('UPDATE hvr_documents SET status=$3 WHERE environment=$1 AND id=$2', [
      c.APP_ENV,
      id,
      paused ? 'paused' : 'active',
    ]);
    await bump(tx, c, id);
    await audit(
      tx,
      c,
      user,
      id,
      paused ? 'pause' : 'resume',
      revision,
      revision + 1,
      row.current_version,
    );
    return { id, revision: revision + 1 };
  });
}
export async function favoriteDocument(
  db: Sql,
  c: Config,
  user: User,
  id: string,
  favorite: boolean,
) {
  requireForms(c, user);
  idSchema.parse(id);
  if (!favorite) {
    await db.query(
      'DELETE FROM hvr_document_favorites WHERE environment=$1 AND user_id=$2 AND document_id=$3',
      [c.APP_ENV, user.id, id],
    );
    return;
  }
  // Lock the document so an overlapping pause/publication cannot create a favorite from stale access.
  await atomic(db, async (tx) => {
    await tx.query('SELECT id FROM hvr_documents WHERE environment=$1 AND id=$2 FOR UPDATE', [
      c.APP_ENV,
      id,
    ]);
    await publishedDocument(tx, c, user, id);
    await tx.query(
      'INSERT INTO hvr_document_favorites(environment,user_id,document_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [c.APP_ENV, user.id, id],
    );
  });
}
