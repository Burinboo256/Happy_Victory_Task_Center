import { createHash } from 'node:crypto';
import type { Config } from '../config';
import { atomic, type Sql } from '../db';
import { type AirtableRepository, type RecordData, recordId } from '../airtable/client';
import { AppError } from '../errors';
import { canonical } from '../operations/journal';
import { businessTables, keyField } from './repository';
import { verifyInstance } from '../runtime';

export async function snapshotTasks(repo: AirtableRepository) {
  const snapshot: Record<string, RecordData[]> = {};
  for (const table of businessTables)
    snapshot[table] = (await repo.list(table)).sort((a, b) => a.id.localeCompare(b.id));
  return snapshot;
}
export const snapshotHash = (snapshot: unknown) =>
  createHash('sha256').update(canonical(snapshot)).digest('hex');

// Caller must freeze all old writers (including Airtable editors) during snapshot and activation.
// Re-run imports only before activation; never replace live Neon tasks with an old mirror.
export async function importTasks(db: Sql, c: Config, repo: AirtableRepository) {
  await verifyInstance(db, c);
  const state = (
    await db.query('SELECT task_writes FROM hvr_runtime WHERE environment=$1', [c.APP_ENV])
  ).rows[0];
  if (state?.task_writes !== false)
    throw new AppError(409, 'IMPORT_WRITES_ACTIVE', 'พักการเขียนก่อนนำเข้า');
  const first = await snapshotTasks(repo),
    second = await snapshotTasks(repo);
  const digest = snapshotHash(first);
  if (digest !== snapshotHash(second))
    throw new AppError(409, 'IMPORT_CHANGED', 'ข้อมูลเปลี่ยนระหว่างนำเข้า');
  const taskIds = new Set(first.tasks.map((r) => r.id));
  for (const table of businessTables)
    for (const row of first[table]) {
      recordId(row.id);
      if (
        table !== 'tasks' &&
        (!Array.isArray(row.fields.Task) ||
          row.fields.Task.length !== 1 ||
          !taskIds.has(String(row.fields.Task[0])))
      )
        throw new AppError(409, 'IMPORT_ORPHAN', 'พบข้อมูลเชื่อมงานไม่ครบ');
    }
  await atomic(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `${c.APP_ENV}:${c.AIRTABLE_BASE_ID}:task-import`,
    ]);
    const storage = (
      await tx.query('SELECT * FROM hvr_task_storage WHERE environment=$1 FOR UPDATE', [c.APP_ENV])
    ).rows[0];
    if (
      (await tx.query('SELECT task_writes FROM hvr_runtime WHERE environment=$1', [c.APP_ENV]))
        .rows[0]?.task_writes !== false
    )
      throw new AppError(409, 'IMPORT_WRITES_ACTIVE', 'พักการเขียนก่อนนำเข้า');
    if (storage?.mode === 'neon')
      throw new AppError(409, 'IMPORT_ALREADY_ACTIVE', 'Space นี้ใช้ Neon แล้ว');
    if (
      (
        await tx.query(
          "SELECT 1 FROM hvr_operations WHERE environment=$1 AND state IN ('running','pending','review') LIMIT 1",
          [c.APP_ENV],
        )
      ).rows.length
    )
      throw new AppError(409, 'IMPORT_OPERATIONS_PENDING', 'มีคำขอค้างที่ต้องตรวจสอบก่อน');
    await tx.query('DELETE FROM hvr_airtable_outbox WHERE environment=$1', [c.APP_ENV]);
    await tx.query('DELETE FROM hvr_task_records WHERE environment=$1', [c.APP_ENV]);
    for (const table of businessTables)
      for (const row of first[table]) {
        const key = keyField(table),
          value = String(row.fields[key] || `import:${row.id}`);
        await tx.query(
          `INSERT INTO hvr_task_records(environment,kind,id,fields,airtable_id,key_field,key_value)
        VALUES($1,$2,$3,$4,$3,$5,$6)`,
          [c.APP_ENV, table, row.id, JSON.stringify(row.fields), key, value],
        );
      }
    await tx.query(
      `INSERT INTO hvr_task_storage(environment,base_id,imported_at,imported_hash) VALUES($1,$2,clock_timestamp(),$3)
      ON CONFLICT(environment) DO UPDATE SET base_id=EXCLUDED.base_id,imported_at=EXCLUDED.imported_at,imported_hash=EXCLUDED.imported_hash`,
      [c.APP_ENV, c.AIRTABLE_BASE_ID, digest],
    );
  });
  return {
    hash: digest,
    counts: Object.fromEntries(businessTables.map((t) => [t, first[t].length])),
  };
}

export async function activateTasks(db: Sql, c: Config, repo: AirtableRepository) {
  const source = await snapshotTasks(repo);
  const imported: Record<string, RecordData[]> = {};
  for (const kind of businessTables)
    imported[kind] = (
      await db.query<RecordData>(
        'SELECT id,fields FROM hvr_task_records WHERE environment=$1 AND kind=$2 ORDER BY id',
        [c.APP_ENV, kind],
      )
    ).rows.sort((a, b) => a.id.localeCompare(b.id));
  const digest = snapshotHash(source);
  if (snapshotHash(imported) !== digest)
    throw new AppError(409, 'IMPORT_MISMATCH', 'ข้อมูลต้นทางไม่ตรงกับ Neon');
  const updated = await db.query(
    `UPDATE hvr_task_storage SET mode='neon',activated_at=clock_timestamp()
    WHERE environment=$1 AND base_id=$2 AND mode='airtable' AND imported_hash=$3
    AND EXISTS(SELECT 1 FROM hvr_runtime WHERE environment=$1 AND task_writes=false)
    AND NOT EXISTS(SELECT 1 FROM hvr_operations WHERE environment=$1 AND state IN ('running','pending','review')) RETURNING environment`,
    [c.APP_ENV, c.AIRTABLE_BASE_ID, digest],
  );
  if (!updated.rows.length) throw new AppError(409, 'IMPORT_NOT_READY', 'ยังไม่พร้อมเปลี่ยนฐานข้อมูลหลัก');
  return { mode: 'neon', hash: digest };
}
