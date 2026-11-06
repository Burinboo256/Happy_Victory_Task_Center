import type { Config } from './config';
import type { Sql } from './db';
import { AppError } from './errors';

export async function verifyInstance(db: Sql, config: Config) {
  const result = await db.query('SELECT base_id FROM hvr_instances WHERE environment=$1', [
    config.APP_ENV,
  ]);
  if (result.rows.length !== 1 || result.rows[0].base_id !== config.AIRTABLE_BASE_ID) {
    throw new AppError(503, 'ENVIRONMENT_MISMATCH', 'ฐานข้อมูลสถานะไม่ตรงกับระบบ กรุณาติดต่อผู้ดูแล');
  }
}
export async function runtimeState(db: Sql, config: Config) {
  await verifyInstance(db, config);
  const result = await db.query('SELECT task_writes,jobs FROM hvr_runtime WHERE environment=$1', [
    config.APP_ENV,
  ]);
  return {
    writes: config.TASK_WRITES_ENABLED && result.rows[0]?.task_writes === true,
    jobs: config.JOBS_ENABLED && result.rows[0]?.jobs === true,
  };
}
export async function requireWrites(db: Sql, config: Config) {
  if (!(await runtimeState(db, config)).writes)
    throw new AppError(503, 'MAINTENANCE', 'ระบบพักการบันทึกชั่วคราว กรุณาลองอีกครั้งภายหลัง');
}
