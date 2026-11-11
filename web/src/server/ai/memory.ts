import type { User } from '../../domain/model';
import type { Config } from '../config';
import type { Sql } from '../db';
import { forbidden } from '../errors';

export type MemoryTurn = {
  question: string;
  answer: string;
  task_ids: string[];
  focus_ids: string[];
};
type TaskRef = { id: string; code: string };
export type Conversation = {
  history: { question: string; answer: string }[];
  followup: boolean;
  focusCodes: string[];
};

export async function cleanMemory(db: Sql, c: Config) {
  await db.query(
    'DELETE FROM hvr_ai_memory_turns WHERE environment=$1 AND expires_at<=clock_timestamp()',
    [c.APP_ENV],
  );
}

// Rotation deletes turns rather than changing their epoch. Old in-flight replies stay invalid.
export async function memorySession(
  db: Sql,
  c: Config,
  user: User,
  binding: string,
  clear = false,
) {
  await db.query(
    `DELETE FROM hvr_ai_memory_sessions WHERE environment=$1 AND user_id=$2
      AND (binding<>$3 OR role<>$4 OR $5)
      AND EXISTS(SELECT 1 FROM hvr_ai_accounts WHERE environment=$1 AND user_id=$2 AND binding=$3)`,
    [c.APP_ENV, user.id, binding, user.role, clear],
  );
  const row = (
    await db.query(
      `INSERT INTO hvr_ai_memory_sessions(environment,user_id,binding,role)
      SELECT environment,user_id,binding,$4 FROM hvr_ai_accounts WHERE environment=$1 AND user_id=$2 AND binding=$3
      ON CONFLICT(environment,user_id) DO UPDATE SET user_id=EXCLUDED.user_id
      RETURNING epoch,binding,role`,
      [c.APP_ENV, user.id, binding, user.role],
    )
  ).rows[0];
  if (!row || row.binding !== binding || row.role !== user.role) throw forbidden();
  return String(row.epoch);
}

export async function readMemory(db: Sql, c: Config, user: User, epoch: string) {
  const rows = (
    await db.query<MemoryTurn>(
      `SELECT question,answer,task_ids,focus_ids FROM hvr_ai_memory_turns
      WHERE environment=$1 AND user_id=$2 AND epoch=$3 AND answer IS NOT NULL
      AND expires_at>clock_timestamp() ORDER BY id DESC LIMIT 6`,
      [c.APP_ENV, user.id, epoch],
    )
  ).rows;
  return rows.reverse();
}

export function authorizedMemory(turns: MemoryTurn[], authorizedIds: string[]) {
  const allowed = new Set(authorizedIds);
  // Answers and questions can refer to any task in their source context, including totals.
  return turns.filter((turn) => turn.task_ids.every((id) => allowed.has(id)));
}

export async function beginMemory(
  db: Sql,
  c: Config,
  user: User,
  epoch: string,
  eventId: string,
  question: string,
  taskIds: string[],
  refs: TaskRef[],
) {
  const row = (
    await db.query(
      `INSERT INTO hvr_ai_memory_turns(environment,user_id,epoch,event_id,question,task_ids,task_refs)
      SELECT environment,user_id,epoch,$4,$5,$6::jsonb,$7::jsonb FROM hvr_ai_memory_sessions
      WHERE environment=$1 AND user_id=$2 AND epoch=$3 RETURNING id`,
      [c.APP_ENV, user.id, epoch, eventId, question, JSON.stringify(taskIds), JSON.stringify(refs)],
    )
  ).rows[0];
  if (!row) throw forbidden();
  return String(row.id);
}

export async function memoryIsCurrent(db: Sql, c: Config, turnId: string) {
  return !!(
    await db.query(
      `SELECT 1 FROM hvr_ai_memory_turns WHERE environment=$1 AND id=$2
      AND expires_at>clock_timestamp() AND answer IS NULL`,
      [c.APP_ENV, turnId],
    )
  ).rows.length;
}

export async function rememberReply(db: Sql, c: Config, turnId: string, answer: string) {
  const row = (
    await db.query(
      `SELECT task_refs FROM hvr_ai_memory_turns WHERE environment=$1 AND id=$2 AND expires_at>clock_timestamp()`,
      [c.APP_ENV, turnId],
    )
  ).rows[0];
  if (!row) return; // Clear/disconnect during the external send must never recreate memory.
  const refs: TaskRef[] = row.task_refs;
  const mentioned = new Set(answer.toLowerCase().match(/hvr-\d+|rec[a-z0-9]{14}/g) || []);
  const focus = refs.filter(
    (r) => mentioned.has(r.code.toLowerCase()) || mentioned.has(r.id.toLowerCase()),
  );
  const ids = (focus.length ? focus : refs.length === 1 ? refs : []).map((r) => r.id);
  const saved = (
    await db.query(
      `UPDATE hvr_ai_memory_turns SET answer=$3,focus_ids=$4::jsonb
      WHERE environment=$1 AND id=$2 AND answer IS NULL AND expires_at>clock_timestamp() RETURNING user_id,epoch`,
      [c.APP_ENV, turnId, answer, JSON.stringify(ids)],
    )
  ).rows[0];
  if (saved)
    await db.query(
      `DELETE FROM hvr_ai_memory_turns WHERE environment=$1 AND user_id=$2 AND epoch=$3 AND answer IS NOT NULL
      AND id NOT IN (SELECT id FROM hvr_ai_memory_turns WHERE environment=$1 AND user_id=$2 AND epoch=$3
        AND answer IS NOT NULL ORDER BY id DESC LIMIT 6)`,
      [c.APP_ENV, saved.user_id, saved.epoch],
    );
}
