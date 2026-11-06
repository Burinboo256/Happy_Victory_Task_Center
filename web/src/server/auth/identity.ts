import type { AirtableRepository } from '../airtable/client';
import { formulaValue } from '../airtable/client';
import { userDto } from '../airtable/dto';
import type { Config } from '../config';
import type { Sql } from '../db';
import { forbidden } from '../errors';

export interface Identity {
  sub: string;
  email: string;
  email_verified: boolean;
  hd?: string;
}
export async function findIdentity(
  repo: AirtableRepository,
  db: Sql,
  config: Config,
  identity: Identity,
) {
  if (!identity.sub || !identity.email || identity.email_verified !== true) throw forbidden();
  const records = await repo.list(
    'users',
    `OR({Google Subject}=${formulaValue(identity.sub)},LOWER({Email})=${formulaValue(identity.email.toLowerCase())})`,
  );
  // Filter again: upstream filtering is not the authorization boundary.
  const matches = records.filter(
    (r) =>
      r.fields['Google Subject'] === identity.sub ||
      String(r.fields.Email || '').toLowerCase() === identity.email.toLowerCase(),
  );
  if (matches.length !== 1) throw forbidden();
  const user = userDto(matches[0]);
  if (!user.active || (user.sub && user.sub !== identity.sub)) throw forbidden();
  if (!user.sub && !/@gmail\.com$/i.test(identity.email) && !identity.hd) throw forbidden();
  // Immutable reservation prevents two Google subjects from racing the first binding.
  const binding = await db.query(
    `INSERT INTO hvr_identity_bindings(environment,user_id,subject) VALUES ($1,$2,$3)
    ON CONFLICT(environment,user_id) DO UPDATE SET subject=hvr_identity_bindings.subject
    WHERE hvr_identity_bindings.subject=EXCLUDED.subject RETURNING subject`,
    [config.APP_ENV, user.id, identity.sub],
  );
  if (binding.rows.length !== 1) throw forbidden();
  if (!user.sub) {
    await repo.patch('users', user.id, { 'Google Subject': identity.sub });
    user.sub = identity.sub;
  }
  await repo.patch('users', user.id, { 'Last Login': new Date().toISOString() });
  return user;
}
