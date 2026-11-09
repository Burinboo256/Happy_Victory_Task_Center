import { registrationSchema, type Registration } from '../../domain/registration';
import type { AirtableRepository } from '../airtable/client';
import { formulaValue } from '../airtable/client';
import { userDto } from '../airtable/dto';
import type { Config } from '../config';
import type { Sql } from '../db';
import { AppError, forbidden } from '../errors';
import { requireWrites } from '../runtime';
import type { Identity } from './identity';
import { hash } from './security';

export type RegistrationStatus = 'pending' | 'existing' | 'review';
export async function registerAgent(
  repo: AirtableRepository,
  db: Sql,
  config: Config,
  identity: Identity,
  input: Registration,
): Promise<RegistrationStatus> {
  const profile = registrationSchema.parse(input);
  if (!identity.sub || !identity.email || identity.email_verified !== true) throw forbidden();
  if (!/@gmail\.com$/i.test(identity.email) && !identity.hd) throw forbidden();
  await requireWrites(db, config);
  const email = identity.email.toLowerCase();
  const records = await repo.list(
    'users',
    `OR({Google Subject}=${formulaValue(identity.sub)},LOWER({Email})=${formulaValue(email)})`,
  );
  const matches = records.filter(
    (r) =>
      r.fields['Google Subject'] === identity.sub ||
      String(r.fields.Email || '').toLowerCase() === email,
  );
  if (matches.length > 1) throw forbidden();
  if (matches.length === 1) {
    const user = userDto(matches[0]);
    if (user.sub && user.sub !== identity.sub) throw forbidden();
    // Registration must never change an existing person's role, approval or profile.
    return user.active ? 'existing' : 'pending';
  }
  const binding = await db.query(
    'SELECT user_id FROM hvr_identity_bindings WHERE environment=$1 AND subject=$2',
    [config.APP_ENV, identity.sub],
  );
  if (binding.rows.length) throw forbidden();
  // A durable, unique claim allows at most one upstream write per verified identity.
  // Never automatically repeat an uncertain write, including after Function termination.
  const claimed = await db.query(
    `INSERT INTO hvr_registrations(environment,subject,email,profile,state)
     VALUES ($1,$2,$3,$4,'writing') ON CONFLICT DO NOTHING RETURNING subject`,
    [config.APP_ENV, identity.sub, email, JSON.stringify(profile)],
  );
  if (!claimed.rows.length) return 'review';
  try {
    await requireWrites(db, config);
    const user = await repo.upsert('users', 'User ID', {
      'User ID': 'REG-' + hash(identity.sub).slice(0, 32),
      'Full Name': profile.fullName,
      Email: email,
      'Google Subject': identity.sub,
      'Agent Code': profile.agentCode,
      Phone: profile.phone,
      Role: 'Agent',
      Active: false,
      'LINE Notifications': false,
    });
    if (
      user.fields['Google Subject'] !== identity.sub ||
      user.fields.Role !== 'Agent' ||
      user.fields.Active === true
    )
      throw new AppError(503, 'REGISTRATION_REVIEW', 'กรุณาติดต่อผู้ดูแลเพื่อตรวจสอบการลงทะเบียน');
    await db.query(
      "UPDATE hvr_registrations SET state='complete',user_id=$3 WHERE environment=$1 AND subject=$2",
      [config.APP_ENV, identity.sub, user.id],
    );
    return 'pending';
  } catch {
    await db.query(
      "UPDATE hvr_registrations SET state='review' WHERE environment=$1 AND subject=$2",
      [config.APP_ENV, identity.sub],
    );
    return 'review';
  }
}
