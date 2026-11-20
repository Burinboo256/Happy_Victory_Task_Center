import { z } from 'zod';
import type { AirtableRepository } from '../airtable/client';
import { userDto } from '../airtable/dto';
import type { Config } from '../config';
import { atomic, type Sql } from '../db';
import { AppError } from '../errors';
import { type ControlPlane, controlFingerprint } from './control';
import { provisionMember } from './service';

export const defaultSpaceId = '00000000-0000-4000-8000-000000000001';
export async function initializeSpaces(
  db: Sql,
  c: Config,
  control: ControlPlane,
  legacy: AirtableRepository,
  ownerEmail: string,
) {
  ownerEmail = z.email().parse(ownerEmail).toLowerCase();
  const users = (await legacy.list('users')).filter(
    (r) =>
      ['Admin', 'Secretary', 'Agent'].includes(String(r.fields.Role)) &&
      z.email().safeParse(r.fields.Email).success,
  );
  const owners = users.filter(
    (r) =>
      String(r.fields.Email).toLowerCase() === ownerEmail &&
      r.fields.Role === 'Admin' &&
      r.fields.Active === true,
  );
  if (owners.length !== 1)
    throw new AppError(422, 'OWNER_REQUIRED', 'ต้องระบุอีเมล Admin ที่ Active ของระบบเดิมเพียงคนเดียว');
  const existing = await db.query('SELECT id FROM public.hvr_workspaces WHERE environment=$1', [
    c.APP_ENV,
  ]);
  if (existing.rows.length)
    throw new AppError(409, 'WORKSPACES_INITIALIZED', 'ระบบ Space ถูกเริ่มแล้ว ไม่ทำ bootstrap ซ้ำ');
  const emails = users.map((r) => String(r.fields.Email).toLowerCase());
  if (new Set(emails).size !== emails.length)
    throw new AppError(409, 'DUPLICATE_EMAIL', 'ตรวจอีเมลซ้ำใน Users ก่อนย้ายระบบ');
  const space = await control.spaces.upsert('users', 'Workspace ID', {
    'Workspace ID': defaultSpaceId,
    Name: 'RINLYN',
    'Base ID': c.AIRTABLE_BASE_ID,
    Active: false,
  });
  const originals = new Map(
    (await control.users.list('users')).map((r) => [String(r.fields.Email || '').toLowerCase(), r]),
  );
  const mappings: { old: string; current: string }[] = [];
  for (const record of users) {
    const user = userDto(record);
    const member = await provisionMember(
      control,
      legacy,
      space.id,
      defaultSpaceId,
      user.email,
      user.role,
      user.active,
      user.name,
    );
    const centralId = (member.fields.User as string[])[0];
    const original = originals.get(user.email.toLowerCase());
    if (original?.fields['Google Subject'] && original.fields['Google Subject'] !== user.sub)
      throw new AppError(409, 'IDENTITY_CONFLICT', 'บัญชีส่วนกลางมี Google identity ไม่ตรงกับระบบเดิม');
    if (centralId !== record.id && !original)
      await control.users.patch('users', centralId, {
        'Google Subject': user.sub || '',
        'Agent Code': record.fields['Agent Code'] || '',
        Phone: record.fields.Phone || '',
        Active: user.active,
      });
    mappings.push({ old: record.id, current: centralId });
  }
  const ownerRows = (await control.users.list('users')).filter(
    (r) => String(r.fields.Email || '').toLowerCase() === ownerEmail,
  );
  if (ownerRows.length !== 1) throw new Error('Owner mapping is not unique');
  await control.users.patch('users', ownerRows[0].id, { 'System Role': 'Owner' });
  await atomic(db, async (tx) => {
    await tx.query(
      'INSERT INTO public.hvr_workspace_control(environment,fingerprint) VALUES($1,$2)',
      [c.APP_ENV, controlFingerprint(c)],
    );
    // Switching identity stores requires a fresh Google login, not a session with a stale record ID.
    await tx.query('DELETE FROM hvr_sessions WHERE environment=$1', [c.APP_ENV]);
    await tx.query('DELETE FROM hvr_oauth WHERE environment=$1', [c.APP_ENV]);
    for (const map of mappings)
      if (map.old !== map.current) {
        await tx.query(
          'UPDATE hvr_identity_bindings SET user_id=$3 WHERE environment=$1 AND user_id=$2',
          [c.APP_ENV, map.old, map.current],
        );
        await tx.query(
          'UPDATE hvr_registrations SET user_id=$3 WHERE environment=$1 AND user_id=$2',
          [c.APP_ENV, map.old, map.current],
        );
      }
    await tx.query(
      'INSERT INTO public.hvr_workspaces(environment,id,name,schema_name,base_id,control_id,active,is_default) VALUES($1,$2,$3,$4,$5,$6,true,true)',
      [c.APP_ENV, defaultSpaceId, 'RINLYN', 'public', c.AIRTABLE_BASE_ID, space.id],
    );
    await tx.query(
      `INSERT INTO public.hvr_workspace_line_routes(environment,line_id,workspace_id,binding)
      SELECT environment,line_id,$2,binding FROM public.hvr_ai_accounts WHERE environment=$1 ON CONFLICT DO NOTHING`,
      [c.APP_ENV, defaultSpaceId],
    );
    for (const [table, kind] of [
      ['hvr_ai_links', 'ai'],
      ['hvr_line_links', 'notifications'],
    ])
      await tx.query(
        `INSERT INTO public.hvr_workspace_line_codes(environment,kind,code_hash,workspace_id,expires_at)
        SELECT environment,$3,code_hash,$2,expires_at FROM ${table} WHERE environment=$1 AND expires_at>clock_timestamp() ON CONFLICT DO NOTHING`,
        [c.APP_ENV, defaultSpaceId, kind],
      );
  });
  await control.spaces.patch('users', space.id, { Active: true });
  return { id: defaultSpaceId, members: users.length };
}
