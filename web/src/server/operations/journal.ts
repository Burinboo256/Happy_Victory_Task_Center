import { randomUUID } from 'node:crypto';
import type { Sql } from '../db';
import type { Config } from '../config';
import { hash } from '../auth/security';
import { AppError, UncertainWrite } from '../errors';
import type { StoredStep, WriteIntent } from './intent';

type Outcome = {
  operationId: string;
  state: 'pending' | 'running' | 'review' | 'completed';
  result?: { id: string };
};
export interface Steps {
  key: string;
  run<T>(name: string, work: () => Promise<T>, write?: boolean, intent?: WriteIntent): Promise<T>;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export class Journal {
  constructor(
    private db: Sql,
    private config: Config,
  ) {}
  async execute(
    userId: string,
    requestId: string,
    action: string,
    payload: unknown,
    resource: string,
    work: (steps: Steps) => Promise<{ id: string }>,
  ): Promise<Outcome> {
    const environment = this.config.APP_ENV,
      id = randomUUID();
    const fingerprint = hash(action + ':' + canonical(payload));
    await this.db.query(
      `INSERT INTO hvr_operations(environment,id,user_id,request_id,fingerprint,resource,action,payload)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(environment,user_id,request_id) DO NOTHING`,
      [environment, id, userId, requestId, fingerprint, resource, action, JSON.stringify(payload)],
    );
    const old = await this.db.query(
      'SELECT * FROM hvr_operations WHERE environment=$1 AND user_id=$2 AND request_id=$3',
      [environment, userId, requestId],
    );
    const operation = old.rows[0];
    if (!operation || operation.fingerprint !== fingerprint)
      throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'คำขอเดิมมีข้อมูลเปลี่ยนไป กรุณาตรวจสอบก่อนส่งใหม่');
    const outcome = (): Outcome => ({
      operationId: operation.id,
      state: operation.state,
      ...(operation.result ? { result: operation.result } : {}),
    });
    if (operation.state === 'completed') {
      await this.db.query('DELETE FROM hvr_resources WHERE environment=$1 AND operation_id=$2', [
        environment,
        operation.id,
      ]);
      return outcome();
    }
    if (['running', 'review'].includes(operation.state)) return outcome();
    if (operation.state === 'failed')
      throw new AppError(409, 'OPERATION_FAILED', 'คำขอนี้ไม่สำเร็จ กรุณาตรวจสอบข้อมูลก่อนส่งใหม่');
    if (operation.retry_at && new Date(operation.retry_at).getTime() > Date.now()) return outcome();
    await this.db.query(
      'INSERT INTO hvr_resources(environment,resource,operation_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [environment, resource, operation.id],
    );
    const reservation = await this.db.query(
      'SELECT operation_id FROM hvr_resources WHERE environment=$1 AND resource=$2',
      [environment, resource],
    );
    if (reservation.rows[0]?.operation_id !== operation.id)
      throw new AppError(409, 'RESOURCE_BUSY', 'งานนี้มีคำขอที่ยังบันทึกไม่ครบ กรุณารอหรือติดต่อผู้ดูแล');
    const claim = await this.db.query(
      `UPDATE hvr_operations SET state='running',updated_at=clock_timestamp() WHERE environment=$1 AND id=$2 AND state='pending' RETURNING id`,
      [environment, operation.id],
    );
    if (!claim.rows.length) return { operationId: operation.id, state: 'running' };
    const steps: Record<string, StoredStep> = operation.steps;
    const save = async () => {
      await this.db.query(
        'UPDATE hvr_operations SET steps=$3,updated_at=clock_timestamp() WHERE environment=$1 AND id=$2',
        [environment, operation.id, JSON.stringify(steps)],
      );
    };
    try {
      const result = await work({
        key: 'web:' + operation.id,
        run: async <T>(
          name: string,
          perform: () => Promise<T>,
          write = true,
          intent?: WriteIntent,
        ) => {
          if (steps[name]?.state === 'completed') return steps[name].value as T;
          if (steps[name]?.state === 'started' && steps[name].write) throw new UncertainWrite();
          steps[name] = { state: 'started', write, ...(intent ? { intent } : {}) };
          await save();
          let value: T;
          try {
            value = await perform();
          } catch (error) {
            // A confirmed rejection or read failure is safe to retry. An ambiguous write is not.
            if (!(error instanceof UncertainWrite) && error instanceof AppError) {
              delete steps[name];
              await save();
            }
            throw error;
          }
          steps[name] = {
            state: 'completed',
            value: value === undefined ? null : value,
            write,
            ...(intent ? { intent } : {}),
          };
          await save();
          return value;
        },
      });
      await this.db.query(
        `WITH done AS (
        UPDATE hvr_operations SET state='completed',result=$3,error_code=NULL,updated_at=clock_timestamp()
        WHERE environment=$1 AND id=$2 RETURNING id
      ) DELETE FROM hvr_resources USING done WHERE hvr_resources.environment=$1 AND hvr_resources.operation_id=done.id`,
        [environment, operation.id, JSON.stringify(result)],
      );
      return { operationId: operation.id, state: 'completed', result };
    } catch (error) {
      const latest = await this.db.query(
        'SELECT state,result FROM hvr_operations WHERE environment=$1 AND id=$2',
        [environment, operation.id],
      );
      if (latest.rows[0]?.state === 'completed')
        return { operationId: operation.id, state: 'completed', result: latest.rows[0].result };
      const retryable =
        error instanceof AppError &&
        error.status === 503 &&
        [
          'AIRTABLE_BUSY',
          'AIRTABLE_UNAVAILABLE',
          'AIRTABLE_ERROR',
          'AIRTABLE_RESPONSE',
          'AIRTABLE_PAGINATION',
        ].includes(error.code);
      const hasWrite = Object.values(steps).some((step) => step.write);
      const review = !retryable && (hasWrite || !(error instanceof AppError));
      const state = review ? 'review' : retryable ? 'pending' : 'failed';
      await this.db.query(
        `UPDATE hvr_operations SET state=$3,error_code=$4,retry_at=clock_timestamp()+($5*interval '1 second'),updated_at=clock_timestamp() WHERE environment=$1 AND id=$2`,
        [
          environment,
          operation.id,
          state,
          error instanceof AppError ? error.code : 'UNAVAILABLE',
          retryable ? (error as AppError).retryAfter || 5 : 0,
        ],
      );
      if (state === 'failed') {
        await this.db.query('DELETE FROM hvr_resources WHERE environment=$1 AND operation_id=$2', [
          environment,
          operation.id,
        ]);
        throw error;
      }
      return { operationId: operation.id, state: review ? 'review' : 'pending' };
    }
  }
}
