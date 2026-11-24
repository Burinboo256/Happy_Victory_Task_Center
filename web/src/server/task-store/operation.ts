import { randomUUID } from 'node:crypto';
import { atomic, type Sql } from '../db';
import type { Config } from '../config';
import type { AirtableRepository } from '../airtable/client';
import { canonical, Journal, type Steps } from '../operations/journal';
import { hash } from '../auth/security';
import { AppError } from '../errors';
import { NeonTaskRepository } from './repository';
import type { StoredStep } from '../operations/intent';

// Neon writes, audit records, outbox and successful idempotency receipt commit together.
// A failed transaction leaves none of those writes behind. Airtable mode retains its journal.
export async function taskOperation(
  db: Sql,
  config: Config,
  repo: AirtableRepository,
  userId: string,
  requestId: string,
  action: string,
  payload: unknown,
  resource: string,
  work: (steps: Steps, repo: AirtableRepository, db: Sql) => Promise<{ id: string }>,
) {
  if (!(repo instanceof NeonTaskRepository))
    return new Journal(db, config).execute(userId, requestId, action, payload, resource, (steps) =>
      work(steps, repo, db),
    );
  return atomic(db, async (tx) => {
    const prefix = `${config.APP_ENV}:${config.AIRTABLE_BASE_ID}`;
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `${prefix}:request:${userId}:${requestId}`,
    ]);
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `${prefix}:resource:${resource}`,
    ]);
    const fingerprint = hash(`${action}:${canonical(payload)}`);
    const existing = (
      await tx.query(
        'SELECT * FROM hvr_operations WHERE environment=$1 AND user_id=$2 AND request_id=$3',
        [config.APP_ENV, userId, requestId],
      )
    ).rows[0];
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'คำขอเดิมมีข้อมูลเปลี่ยนไป');
      if (existing.state !== 'completed')
        throw new AppError(409, 'RESOURCE_BUSY', 'คำขอเดิมยังตรวจสอบไม่เสร็จ');
      return {
        operationId: existing.id as string,
        state: 'completed' as const,
        result: existing.result as { id: string },
      };
    }
    if (
      (
        await tx.query('SELECT 1 FROM hvr_resources WHERE environment=$1 AND resource=$2', [
          config.APP_ENV,
          resource,
        ])
      ).rows.length
    )
      throw new AppError(409, 'RESOURCE_BUSY', 'งานนี้มีคำขอที่ยังบันทึกไม่ครบ');
    const id = randomUUID();
    await tx.query(
      `INSERT INTO hvr_operations(environment,id,user_id,request_id,fingerprint,resource,action,payload,state,result)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'running',NULL)`,
      [
        config.APP_ENV,
        id,
        userId,
        requestId,
        fingerprint,
        resource,
        action,
        JSON.stringify(payload),
      ],
    );
    const reserved = await tx.query(
      'INSERT INTO hvr_resources(environment,resource,operation_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING operation_id',
      [config.APP_ENV, resource, id],
    );
    if (!reserved.rows.length) throw new AppError(409, 'RESOURCE_BUSY', 'งานนี้มีคำขอที่ยังบันทึกไม่ครบ');
    const steps: Record<string, StoredStep> = {};
    const result = await work(
      {
        key: `web:${id}`,
        run: async (name, perform, write = true, intent) => {
          const value = await perform();
          steps[name] = {
            state: 'completed',
            value: value === undefined ? null : value,
            write,
            ...(intent ? { intent } : {}),
          };
          return value;
        },
      },
      repo.withDatabase(tx),
      tx,
    );
    // Preserve the existing LINE triggers, including the pre-completion task snapshot.
    await tx.query(
      "UPDATE hvr_operations SET state='completed',result=$3,steps=$4 WHERE environment=$1 AND id=$2",
      [config.APP_ENV, id, JSON.stringify(result), JSON.stringify(steps)],
    );
    await tx.query('DELETE FROM hvr_resources WHERE environment=$1 AND operation_id=$2', [
      config.APP_ENV,
      id,
    ]);
    return { operationId: id, state: 'completed' as const, result };
  });
}
