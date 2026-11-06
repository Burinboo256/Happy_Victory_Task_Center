import type { Config } from '../config';
import type { Sql } from '../db';
import type { AirtableRepository } from '../airtable/client';
import { userDto } from '../airtable/dto';
import { forbidden, unauthenticated } from '../errors';
import { hash, randomToken } from './security';
import { verifyInstance } from '../runtime';

export async function createSession(db: Sql, config: Config, user: { id: string; sub: string }) {
  const token = randomToken(),
    csrfToken = randomToken();
  await db.query(
    `INSERT INTO hvr_sessions(environment,token_hash,user_id,subject,csrf_token,expires_at) VALUES ($1,$2,$3,$4,$5,clock_timestamp()+interval '6 hours')`,
    [config.APP_ENV, hash(token), user.id, user.sub, csrfToken],
  );
  return { token, csrfToken };
}
export async function authenticate(
  db: Sql,
  repo: AirtableRepository,
  config: Config,
  token?: string,
) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw unauthenticated();
  await verifyInstance(db, config);
  const result = await db.query(
    'SELECT user_id,subject,csrf_token FROM hvr_sessions WHERE environment=$1 AND token_hash=$2 AND expires_at>clock_timestamp()',
    [config.APP_ENV, hash(token)],
  );
  const session = result.rows[0];
  if (!session) throw unauthenticated();
  const user = userDto(await repo.get('users', session.user_id));
  if (!user.active || !user.sub || user.sub !== session.subject) throw forbidden();
  return { user, csrfToken: session.csrf_token as string };
}
export async function revokeSession(db: Sql, config: Config, token: string) {
  await db.query('DELETE FROM hvr_sessions WHERE environment=$1 AND token_hash=$2', [
    config.APP_ENV,
    hash(token),
  ]);
}
