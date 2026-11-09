import { randomUUID } from 'node:crypto';
import type { Config } from '../config';
import type { Sql } from '../db';
import type { AirtableRepository } from '../airtable/client';
import { userDto } from '../airtable/dto';
import { verifyInstance } from '../runtime';
import { AppError } from '../errors';
import { lineConfigured, pushMessage } from './client';
import { newTaskMessage, summarySchema } from './message';

export async function drainLineQueue(
  db: Sql,
  config: Config,
  repo: AirtableRepository,
  transport: typeof fetch = fetch,
) {
  if (!config.ENABLE_LINE_NOTIFICATIONS || !lineConfigured(config)) return { processed: 0 };
  await verifyInstance(db, config);
  const setting = await db.query('SELECT enabled FROM hvr_line_settings WHERE environment=$1', [
    config.APP_ENV,
  ]);
  if (!setting.rows[0]?.enabled) return { processed: 0 };
  // LINE deduplicates only for 24 hours. Use a conservative 23-hour retry window.
  await db.query(
    `UPDATE hvr_line_deliveries SET state='review',error_code='RETRY_WINDOW_EXPIRED',updated_at=clock_timestamp()
    WHERE environment=$1 AND state IN ('pending','sending') AND first_attempt_at<clock_timestamp()-interval '23 hours'
      AND (lease_until IS NULL OR lease_until<clock_timestamp())`,
    [config.APP_ENV],
  );
  let processed = 0;
  const deadline = Date.now() + 25000;
  while (processed < 3 && Date.now() < deadline) {
    const claim = randomUUID();
    const claimed = await db.query(
      `WITH candidate AS (
      SELECT id FROM hvr_line_deliveries WHERE environment=$1
        AND ((state='pending' AND next_attempt_at<=clock_timestamp()) OR (state='sending' AND lease_until<clock_timestamp()))
        AND (first_attempt_at IS NULL OR first_attempt_at>clock_timestamp()-interval '23 hours')
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
    ) UPDATE hvr_line_deliveries d SET state='sending',claim=$2,lease_until=clock_timestamp()+interval '90 seconds',
      attempts=attempts+1,updated_at=clock_timestamp()
      FROM candidate c WHERE d.environment=$1 AND d.id=c.id RETURNING d.*`,
      [config.APP_ENV, claim],
    );
    const row = claimed.rows[0];
    if (!row) break;
    processed++;
    let state = 'pending',
      code: string | null = null;
    try {
      const account = await db.query(
        `SELECT a.user_id FROM hvr_line_accounts a JOIN hvr_line_settings s USING(environment)
        WHERE a.environment=$1 AND a.user_id=$2 AND a.binding=$3 AND a.line_id=$4 AND a.enabled AND s.enabled`,
        [config.APP_ENV, row.user_id, row.binding, row.line_id],
      );
      if (!account.rows.length) {
        state = 'cancelled';
        code = 'RECIPIENT_DISABLED';
      } else {
        const recipient = userDto(await repo.get('users', row.user_id));
        if (!recipient.active || recipient.role !== 'Secretary') {
          state = 'cancelled';
          code = 'RECIPIENT_INACTIVE';
        } else {
          let message = row.message;
          if (!message) {
            const summary = summarySchema.parse(row.summary);
            const sender = userDto(await repo.get('users', summary.senderId));
            message = newTaskMessage(config.APP_ORIGIN, row.task_id, summary, sender.name);
          }
          // Persist the EXACT payload and first attempt before any external call.
          // A process dying here can retry with the same recipient, payload and UUID.
          const saved = await db.query(
            `UPDATE hvr_line_deliveries SET message=COALESCE(message,$4),first_attempt_at=COALESCE(first_attempt_at,clock_timestamp())
            WHERE environment=$1 AND id=$2 AND claim=$3 AND state='sending' RETURNING message`,
            [config.APP_ENV, row.id, claim, JSON.stringify(message)],
          );
          if (!saved.rows.length) continue;
          const outcome = await pushMessage(
            config,
            row.line_id,
            row.id,
            saved.rows[0].message,
            transport,
          );
          state = outcome === 'retry' ? 'pending' : outcome;
          code = outcome === 'retry' ? 'LINE_BUSY' : outcome === 'failed' ? 'LINE_REJECTED' : null;
        }
      }
    } catch (error) {
      if (error instanceof AppError && error.status === 404) {
        state = 'cancelled';
        code = 'USER_REMOVED';
      } else code = 'DELIVERY_UNAVAILABLE';
    }
    await db.query(
      `UPDATE hvr_line_deliveries SET state=$4,error_code=$5,lease_until=NULL,claim=NULL,
      next_attempt_at=clock_timestamp()+($6*interval '1 second'),updated_at=clock_timestamp()
      WHERE environment=$1 AND id=$2 AND claim=$3`,
      [
        config.APP_ENV,
        row.id,
        claim,
        state,
        code,
        Math.min(3600, 30 * 2 ** Math.min(row.attempts, 7)),
      ],
    );
  }
  return { processed };
}

export async function safelyDrainLineQueue(db: Sql, config: Config, repo: AirtableRepository) {
  try {
    await drainLineQueue(db, config, repo);
  } catch {
    console.error('line_queue_unavailable');
  }
}
