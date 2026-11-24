import type { Config } from '../config';
import { atomic, type Sql } from '../db';
import type { AirtableRepository } from '../airtable/client';
import { AppError, UncertainWrite } from '../errors';
import type { BusinessTable } from './repository';
import { canonical } from '../operations/journal';
import { formulaValue } from '../airtable/client';

// Never send Airtable computed values, stale attachment URLs or Control-plane fields.
const writable: Record<BusinessTable, readonly string[]> = {
  tasks: [
    'Request Key',
    'Task Title',
    'Description',
    'Case Name',
    'Agent',
    'Assigned Secretary',
    'Category',
    'Priority',
    'Status',
    'Due Date',
    'Reference URL',
    'Completed At',
    'Next Follow-up',
  ],
  updates: [
    'Operation Key',
    'Task',
    'Updated By',
    'Actor Name',
    'Update Type',
    'Message',
    'Visible to Agent',
    'Old Status',
    'New Status',
  ],
  followups: [
    'Operation Key',
    'Task',
    'Follow-up Date',
    'Assigned To',
    'Follow-up Status',
    'Result / Notes',
    'Completed At',
  ],
  notifications: [
    'Operation Key',
    'Task',
    'Recipient',
    'Channel',
    'Event Type',
    'Message',
    'Delivery Status',
  ],
};
type Event = {
  kind: BusinessTable;
  record_id: string;
  version: string;
  fields: Record<string, unknown>;
  attempts: number;
  airtable_id: string | null;
  key_field: string;
  key_value: string;
};
async function mirrorFields(db: Sql, c: Config, event: Event) {
  const fields = Object.fromEntries(
    Object.entries(event.fields).filter(([name]) => writable[event.kind].includes(name)),
  );
  fields[event.key_field] = event.key_value;
  if (Array.isArray(fields.Task)) {
    const ids: string[] = [];
    for (const id of fields.Task) {
      const parent = (
        await db.query(
          "SELECT airtable_id FROM hvr_task_records WHERE environment=$1 AND kind='tasks' AND id=$2",
          [c.APP_ENV, id],
        )
      ).rows[0];
      if (!parent?.airtable_id) throw new AppError(503, 'SYNC_PARENT_PENDING', 'รอซิงก์งานหลัก');
      ids.push(parent.airtable_id);
    }
    fields.Task = ids;
  }
  return fields;
}

export async function drainTaskMirror(db: Sql, c: Config, airtable: AirtableRepository, limit = 3) {
  let processed = 0;
  for (let i = 0; i < Math.min(limit, 10); i++) {
    const result = await atomic(db, async (tx) => {
      // Serialize this Space's mirror workers, not user writes. Event payloads are immutable.
      const lock = (
        await tx.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', [
          `${c.APP_ENV}:${c.AIRTABLE_BASE_ID}:task-mirror`,
        ])
      ).rows[0];
      if (!lock?.locked) return false;
      const storage = (
        await tx.query('SELECT * FROM hvr_task_storage WHERE environment=$1', [c.APP_ENV])
      ).rows[0];
      if (storage?.mode !== 'neon' || storage.base_id !== c.AIRTABLE_BASE_ID) return false;
      const event = (
        await tx.query<Event>(
          `SELECT o.*,r.airtable_id,r.key_field,r.key_value FROM hvr_airtable_outbox o
        JOIN hvr_task_records r ON r.environment=o.environment AND r.kind=o.kind AND r.id=o.record_id
        WHERE o.environment=$1 AND o.state='pending' AND o.next_attempt_at<=clock_timestamp()
        AND NOT EXISTS(SELECT 1 FROM hvr_airtable_outbox p WHERE p.environment=o.environment AND p.kind=o.kind
          AND p.record_id=o.record_id AND p.version<o.version AND p.state<>'synced')
        ORDER BY CASE WHEN o.kind='tasks' THEN 0 ELSE 1 END,o.next_attempt_at,o.record_id,o.version
        LIMIT 1 FOR UPDATE OF o SKIP LOCKED`,
          [c.APP_ENV],
        )
      ).rows[0];
      if (!event) return false;
      const args = [c.APP_ENV, event.kind, event.record_id, event.version];
      try {
        const fields = await mirrorFields(tx, c, event);
        const saved = event.airtable_id
          ? await airtable.patch(event.kind, event.airtable_id, fields)
          : await airtable.upsert(event.kind, event.key_field, fields);
        await tx.query(
          'UPDATE hvr_task_records SET airtable_id=$4 WHERE environment=$1 AND kind=$2 AND id=$3',
          [c.APP_ENV, event.kind, event.record_id, saved.id],
        );
        await tx.query(
          `UPDATE hvr_airtable_outbox SET state='synced',attempts=attempts+1,last_synced_at=clock_timestamp(),error_code=NULL
          WHERE environment=$1 AND kind=$2 AND record_id=$3 AND version=$4`,
          args,
        );
      } catch (error) {
        // An ambiguous external write cannot safely be overtaken by a newer version.
        // Keep it for explicit reconciliation; confirmed transient rejection retries automatically.
        const retry =
          error instanceof AppError &&
          !(error instanceof UncertainWrite) &&
          ['AIRTABLE_BUSY', 'AIRTABLE_UNAVAILABLE', 'SYNC_PARENT_PENDING'].includes(error.code);
        const state = retry && event.attempts < 9 ? 'pending' : 'review';
        const delay = Math.max(
          error instanceof AppError ? error.retryAfter || 0 : 0,
          Math.min(3600, 5 * 2 ** Math.min(event.attempts, 9)),
        );
        await tx.query(
          `UPDATE hvr_airtable_outbox SET state=$5,attempts=attempts+1,error_code=$6,next_attempt_at=clock_timestamp()+$7*interval '1 second'
          WHERE environment=$1 AND kind=$2 AND record_id=$3 AND version=$4`,
          [...args, state, error instanceof AppError ? error.code : 'SYNC_UNAVAILABLE', delay],
        );
      }
      return true;
    });
    if (!result) break;
    processed++;
  }
  return { processed, ...(await taskSyncStatus(db, c)) };
}

export async function taskSyncStatus(db: Sql, c: Config) {
  const result = (
    await db.query(
      `SELECT count(*) FILTER(WHERE state='pending')::int AS pending,
    count(*) FILTER(WHERE state='review')::int AS review,max(last_synced_at) AS last_synced_at
    FROM hvr_airtable_outbox WHERE environment=$1`,
      [c.APP_ENV],
    )
  ).rows[0];
  return {
    pending: result.pending as number,
    review: result.review as number,
    lastSyncedAt: result.last_synced_at ? new Date(result.last_synced_at).toISOString() : null,
  };
}

// Operator must first establish that the uncertain invocation has stopped.
// Match fields before acknowledging a lost response; otherwise replay this exact event first.
export async function reviewTaskMirror(
  db: Sql,
  c: Config,
  airtable: AirtableRepository,
  kind: BusinessTable,
  id: string,
  version: number,
  evidence: string,
  confirmedStopped: boolean,
) {
  if (!confirmedStopped || evidence.trim().length < 8)
    throw new AppError(409, 'SYNC_REVIEW_EVIDENCE', 'ต้องยืนยันว่าคำขอเดิมหยุดแล้วและระบุหลักฐาน');
  return atomic(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `${c.APP_ENV}:${c.AIRTABLE_BASE_ID}:task-mirror`,
    ]);
    const event = (
      await tx.query<Event>(
        `SELECT o.*,r.airtable_id,r.key_field,r.key_value FROM hvr_airtable_outbox o
      JOIN hvr_task_records r ON r.environment=o.environment AND r.kind=o.kind AND r.id=o.record_id
      WHERE o.environment=$1 AND o.kind=$2 AND o.record_id=$3 AND o.version=$4 AND o.state='review' FOR UPDATE OF o`,
        [c.APP_ENV, kind, id, version],
      )
    ).rows[0];
    if (!event) throw new AppError(404, 'SYNC_REVIEW_NOT_FOUND', 'ไม่พบรายการตรวจสอบ');
    const fields = await mirrorFields(tx, c, event);
    const records = event.airtable_id
      ? [await airtable.get(kind, event.airtable_id)]
      : (await airtable.list(kind, `{${event.key_field}}=${formulaValue(event.key_value)}`)).filter(
          (r) => r.fields[event.key_field] === event.key_value,
        );
    if (records.length > 1) throw new AppError(409, 'SYNC_DUPLICATE', 'พบรายการซ้ำ ต้องตรวจสอบก่อน');
    const normalize = (v: unknown) =>
      v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length)
        ? null
        : v;
    const matches =
      records.length === 1 &&
      Object.entries(fields).every(
        ([name, value]) =>
          canonical(normalize(value)) === canonical(normalize(records[0].fields[name])),
      );
    if (matches)
      await tx.query(
        'UPDATE hvr_task_records SET airtable_id=$4 WHERE environment=$1 AND kind=$2 AND id=$3',
        [c.APP_ENV, kind, id, records[0].id],
      );
    await tx.query(
      `UPDATE hvr_airtable_outbox SET state=$5,error_code=NULL,attempts=0,next_attempt_at=clock_timestamp(),
      last_synced_at=CASE WHEN $5='synced' THEN clock_timestamp() ELSE last_synced_at END
      WHERE environment=$1 AND kind=$2 AND record_id=$3 AND version=$4`,
      [c.APP_ENV, kind, id, version, matches ? 'synced' : 'pending'],
    );
    await tx.query(
      'INSERT INTO hvr_task_sync_reviews(environment,kind,record_id,version,evidence,resolution) VALUES($1,$2,$3,$4,$5,$6)',
      [c.APP_ENV, kind, id, version, evidence, matches ? 'confirmed' : 'retry'],
    );
    return { resolution: matches ? 'confirmed' : 'retry' };
  });
}
