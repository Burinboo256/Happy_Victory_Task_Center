import type { AirtableRepository } from '../airtable/client';
import type { Config } from '../config';
import type { Sql } from '../db';
import { AppError } from '../errors';

// An accepted create can be visible in Airtable before its audit is confirmed.
// The create reservation has a different resource key, so protect later task mutations here.
export async function requireTaskReady(
  db: Sql,
  config: Config,
  repo: AirtableRepository,
  id: string,
) {
  const key = (await repo.get('tasks', id)).fields['Request Key'];
  if (typeof key !== 'string' || !key.startsWith('web:')) return;
  const operationId = key.slice(4);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId))
    throw new AppError(409, 'TASK_INITIALIZING', 'งานนี้ยังบันทึกไม่ครบ กรุณาติดต่อผู้ดูแล');
  const operation = await db.query(
    "SELECT state FROM hvr_operations WHERE environment=$1 AND id=$2 AND action='create'",
    [config.APP_ENV, operationId],
  );
  if (operation.rows[0]?.state !== 'completed')
    throw new AppError(409, 'TASK_INITIALIZING', 'งานนี้ยังบันทึกไม่ครบ กรุณารอหรือติดต่อผู้ดูแล');
}
