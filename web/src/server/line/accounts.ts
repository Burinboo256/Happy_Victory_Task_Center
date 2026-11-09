import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { User } from '../../domain/model';
import type { Config } from '../config';
import type { Sql } from '../db';
import type { AirtableRepository } from '../airtable/client';
import { userDto } from '../airtable/dto';
import { hash } from '../auth/security';
import { AppError, forbidden } from '../errors';
import { lineConfigured, lineId, lineProfile } from './client';

export function requireSecretary(user: User) {
  if (!user.active || user.role !== 'Secretary') throw forbidden();
}
export async function startLink(db: Sql, config: Config, user: User) {
  requireSecretary(user);
  if (!lineConfigured(config)) throw new AppError(503, 'LINE_SETUP', 'ผู้ดูแลยังเชื่อม OA ไม่ครบ');
  const code = randomBytes(12).toString('hex');
  await db.query(
    `INSERT INTO hvr_line_links(environment,user_id,code_hash,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '10 minutes')
    ON CONFLICT(environment,user_id) DO UPDATE SET code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at,candidate_id=NULL`,
    [config.APP_ENV, user.id, hash(code)],
  );
  return { code: 'HVR ' + code, expiresIn: 600 };
}
export async function linkCandidate(db: Sql, config: Config, user: User) {
  requireSecretary(user);
  return (
    await db.query(
      'SELECT candidate_id FROM hvr_line_links WHERE environment=$1 AND user_id=$2 AND expires_at>clock_timestamp()',
      [config.APP_ENV, user.id],
    )
  ).rows[0]?.candidate_id as string | undefined;
}
export async function confirmLink(
  db: Sql,
  config: Config,
  user: User,
  candidate: string,
  transport: typeof fetch = fetch,
) {
  requireSecretary(user);
  lineId.parse(candidate);
  if ((await linkCandidate(db, config, user)) !== candidate)
    throw new AppError(409, 'LINE_LINK_EXPIRED', 'รหัสหมดอายุหรือบัญชีเปลี่ยน กรุณาเชื่อมใหม่');
  const name = await lineProfile(config, candidate, transport);
  try {
    const result = await db.query(
      `WITH used AS (
      DELETE FROM hvr_line_links WHERE environment=$1 AND user_id=$2 AND candidate_id=$3 AND expires_at>clock_timestamp() RETURNING user_id
    ) INSERT INTO hvr_line_accounts(environment,user_id,line_id,display_name)
      SELECT $1,user_id,$3,$4 FROM used
      ON CONFLICT(environment,user_id) DO UPDATE SET line_id=EXCLUDED.line_id,display_name=EXCLUDED.display_name,
        binding=gen_random_uuid(),enabled=false,linked_at=clock_timestamp() RETURNING user_id`,
      [config.APP_ENV, user.id, candidate, name],
    );
    if (!result.rows.length) throw new AppError(409, 'LINE_LINK_EXPIRED', 'รหัสถูกใช้แล้ว กรุณาโหลดใหม่');
  } catch (error) {
    if ((error as { code?: string }).code === '23505')
      throw new AppError(409, 'LINE_ALREADY_LINKED', 'LINE นี้เชื่อมกับสมาชิกอื่นแล้ว');
    throw error;
  }
}
export async function disconnectLine(db: Sql, config: Config, user: User) {
  requireSecretary(user);
  await db.query(
    `WITH removed AS (DELETE FROM hvr_line_accounts WHERE environment=$1 AND user_id=$2)
    DELETE FROM hvr_line_links WHERE environment=$1 AND user_id=$2`,
    [config.APP_ENV, user.id],
  );
}

const eventSchema = z.object({
  destination: lineId,
  events: z
    .array(
      z
        .object({
          type: z.string(),
          timestamp: z.number(),
          source: z.object({ type: z.string(), userId: lineId.optional() }).optional(),
          message: z
            .object({ type: z.string(), text: z.string().optional() })
            .passthrough()
            .optional(),
        })
        .passthrough(),
    )
    .max(100),
});
export async function receiveWebhook(db: Sql, config: Config, input: unknown) {
  const body = eventSchema.parse(input);
  if (body.destination !== config.LINE_BOT_USER_ID) throw forbidden();
  for (const event of body.events) {
    // Group rooms are never account-linking proofs or notification recipients.
    if (event.source?.type !== 'user' || !event.source.userId) continue;
    const id = event.source.userId;
    if (event.type === 'unfollow') {
      await db.query(
        `UPDATE hvr_line_accounts SET enabled=false WHERE environment=$1 AND line_id=$2 AND linked_at<=to_timestamp($3/1000.0)`,
        [config.APP_ENV, id, event.timestamp],
      );
    }
    if (event.type !== 'message' || event.message?.type !== 'text') continue;
    const match = /^HVR ([a-f0-9]{24})$/i.exec(event.message.text?.trim() || '');
    if (!match) continue;
    // Only the first LINE account claiming a one-time code can become the candidate.
    await db.query(
      `UPDATE hvr_line_links SET candidate_id=$3 WHERE environment=$1 AND code_hash=$2
      AND expires_at>clock_timestamp() AND (candidate_id IS NULL OR candidate_id=$3)`,
      [config.APP_ENV, hash(match[1].toLowerCase()), id],
    );
  }
}
export async function setRecipient(
  db: Sql,
  config: Config,
  repo: AirtableRepository,
  actor: User,
  userId: string,
  binding: string,
  enabled: boolean,
) {
  if (actor.role !== 'Admin') throw forbidden();
  z.uuid().parse(binding);
  if (enabled) requireSecretary(userDto(await repo.get('users', userId)));
  const result = await db.query(
    `UPDATE hvr_line_accounts SET enabled=$4 WHERE environment=$1 AND user_id=$2 AND binding=$3 RETURNING user_id`,
    [config.APP_ENV, userId, binding, enabled],
  );
  if (!result.rows.length)
    throw new AppError(409, 'LINE_ACCOUNT_CHANGED', 'บัญชี LINE เปลี่ยน กรุณาโหลดใหม่');
}
