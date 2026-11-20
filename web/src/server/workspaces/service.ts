import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { AirtableClient, formulaValue, type AirtableRepository } from '../airtable/client';
import { userDto } from '../airtable/dto';
import { inspectSchema } from '../airtable/schema';
import type { Config } from '../config';
import { atomic, type Sql } from '../db';
import { AppError, forbidden } from '../errors';
import type { User } from '../../domain/model';
import { roles } from '../../domain/model';
import { hash } from '../auth/security';
import { type ControlPlane, workspaceRepository, controlFingerprint } from './control';
import { baseCredentials, decryptCredentials, encryptCredentials } from './credentials';
import { workspaceDatabase, createOperationalSchema } from './database';
import { verifyInstance } from '../runtime';

export const workspaceCookie = (c: Config) =>
  `${c.APP_ORIGIN.startsWith('https:') ? '__Host-' : ''}hvr-space`;
export const workspaceCsrf = (token: string, id: string) =>
  createHmac('sha256', token)
    .update('workspace:' + id)
    .digest('hex');
export { workspaceUrl } from './url';
export type SpaceRow = {
  id: string;
  name: string;
  schema_name: string;
  base_id: string;
  control_id: string;
  credentials: string | null;
  active: boolean;
  is_default: boolean;
};
export async function modeGuard(db: Sql, c: Config) {
  const exists = (await db.query("SELECT to_regclass('public.hvr_workspaces') AS name")).rows[0]
    ?.name;
  if (!exists) {
    if (c.WORKSPACES_ENABLED)
      throw new AppError(503, 'WORKSPACE_MIGRATION', 'กรุณาเตรียมฐานข้อมูล Space ก่อนเปิดใช้งาน');
    return;
  }
  const rows = await db.query('SELECT 1 FROM public.hvr_workspaces WHERE environment=$1 LIMIT 1', [
    c.APP_ENV,
  ]);
  if (rows.rows.length && !c.WORKSPACES_ENABLED)
    throw new AppError(
      503,
      'WORKSPACE_MODE_REQUIRED',
      'ระบบหลาย Space อยู่ระหว่างเตรียมเปิด กรุณาติดต่อเจ้าของระบบ',
    );
  if (c.WORKSPACES_ENABLED) {
    const binding = (
      await db.query('SELECT fingerprint FROM public.hvr_workspace_control WHERE environment=$1', [
        c.APP_ENV,
      ])
    ).rows[0];
    if (!binding || binding.fingerprint !== controlFingerprint(c))
      throw new AppError(
        503,
        'WORKSPACE_CONTROL_MISMATCH',
        'การเชื่อมต่อตารางกลางไม่ตรงกับระบบ กรุณาติดต่อเจ้าของระบบ',
      );
  }
}
export async function getSpace(root: Sql, c: Config, id?: string) {
  if (id) z.uuid().parse(id);
  const rows = await root.query<SpaceRow>(
    `SELECT * FROM public.hvr_workspaces WHERE environment=$1 AND ${id ? 'id=$2' : 'is_default=true'}`,
    id ? [c.APP_ENV, id] : [c.APP_ENV],
  );
  if (rows.rows.length !== 1)
    throw new AppError(403, 'WORKSPACE_REQUIRED', 'กรุณาเลือก Space ที่คุณเป็นสมาชิก');
  return rows.rows[0];
}
export async function spaceServices(root: Sql, c: Config, control: ControlPlane, id?: string) {
  const row = await getSpace(root, c, id);
  const record = await control.workspace(row.id);
  if (
    !row.active ||
    record.id !== row.control_id ||
    record.fields.Active !== true ||
    record.fields['Base ID'] !== row.base_id
  )
    throw new AppError(403, 'WORKSPACE_PAUSED', 'Space นี้พักใช้งานหรือการตั้งค่าไม่ตรงกัน');
  const name = z.string().trim().min(1).max(80).parse(record.fields.Name);
  const credentials = row.credentials ? decryptCredentials(c, row.id, row.credentials) : c;
  if (credentials.AIRTABLE_BASE_ID !== row.base_id) throw forbidden();
  const config: Config = { ...c, ...credentials, workspace: { id: row.id, name } };
  const db = workspaceDatabase(root, row.schema_name);
  await verifyInstance(db, config);
  // Rate limiting is shared by Base ID in the control database, never split by Workspace schema.
  const rawRepo = control.repository(config, root);
  const repo = workspaceRepository(rawRepo, control, row.control_id);
  return { row, config, db, repo, rawRepo };
}
export async function authorizeSpace(
  root: Sql,
  c: Config,
  control: ControlPlane,
  user: User,
  id?: string,
) {
  const context = await spaceServices(root, c, control, id);
  const member = await control.member(context.row.control_id, user.id);
  if (!member.active) throw new AppError(403, 'WORKSPACE_PENDING', 'สมาชิก Space นี้ยังไม่ได้รับอนุมัติ');
  const localUser = userDto(await context.repo.get('users', member.localUserId));
  if (!localUser.active || localUser.sub !== user.sub) throw forbidden();
  return { ...context, user: localUser };
}
export async function listSpaces(root: Sql, c: Config, control: ControlPlane, user: User) {
  const [owner, members, rows] = await Promise.all([
    control.owner(user.id),
    control.forUser(user.id),
    root.query<SpaceRow>(
      'SELECT * FROM public.hvr_workspaces WHERE environment=$1 ORDER BY created_at,id',
      [c.APP_ENV],
    ),
  ]);
  const permitted = rows.rows.filter(
    (row) => owner || members.some((m) => m.workspace === row.control_id),
  );
  const records = await control.spaces.list('users');
  const items = permitted.map((row) => {
    const matches = records.filter((r) => r.fields['Workspace ID'] === row.id);
    if (matches.length !== 1) throw forbidden();
    const record = matches[0];
    const member = members.find((m) => m.workspace === row.control_id);
    return {
      id: row.id,
      name: String(record.fields.Name || row.name),
      active:
        row.active && record.fields.Active === true && record.fields['Base ID'] === row.base_id,
      role: member?.role || null,
      approved: member?.active || false,
      baseId: owner ? row.base_id : undefined,
      isDefault: row.is_default,
    };
  });
  return { owner, items };
}
export const createSpaceInput = z
  .object({
    requestId: z.uuid(),
    name: z.string().trim().min(1).max(80),
    adminEmail: z.email().transform((v) => v.toLowerCase()),
    credentials: baseCredentials,
    schemaToken: z.string().min(12).max(1000),
  })
  .strict();
export async function createSpace(
  root: Sql,
  c: Config,
  control: ControlPlane,
  actor: User,
  input: unknown,
  transport: typeof fetch = fetch,
) {
  await control.requireOwner(actor.id);
  const data = createSpaceInput.parse(input),
    id = data.requestId;
  const prior = (
    await root.query(
      'SELECT id,state FROM public.hvr_workspace_setups WHERE environment=$1 AND base_id=$2',
      [c.APP_ENV, data.credentials.AIRTABLE_BASE_ID],
    )
  ).rows[0];
  if (prior) {
    if (prior.id === id && prior.state === 'complete') return { id };
    throw new AppError(
      409,
      'WORKSPACE_SETUP_REVIEW',
      'Base นี้มีคำขอสร้าง Space แล้ว กรุณาให้เจ้าของระบบตรวจผลเดิมก่อนสร้างซ้ำ',
    );
  }
  const candidate = new AirtableClient({ ...c, ...data.credentials }, root, transport);
  const issues = inspectSchema(await candidate.schema(data.schemaToken), {
    ...c,
    ...data.credentials,
  });
  if (issues.length)
    throw new AppError(422, 'WORKSPACE_SCHEMA', 'Base ยังมีโครงสร้างไม่ครบ กรุณาตรวจ schema ด้วยคู่มือก่อน');
  if (data.credentials.AIRTABLE_BASE_ID === c.AIRTABLE_BASE_ID)
    throw new AppError(409, 'WORKSPACE_BASE_USED', 'Base นี้เป็นของ Space แรกแล้ว');
  for (const table of ['tasks', 'updates', 'followups', 'notifications'] as const)
    if ((await candidate.list(table)).length)
      throw new AppError(
        422,
        'WORKSPACE_NOT_EMPTY',
        'กรุณาใช้ Base ว่างสำหรับ Space ใหม่ การนำเข้างานเดิมต้องวางแผนแยก',
      );
  const encrypted = encryptCredentials(c, id, data.credentials);
  // A durable reservation precedes any control-plane write. A failed attempt never activates a Space.
  const schemaName = 'hvr_ws_' + id.replaceAll('-', '');
  const reserved = await root.query(
    `INSERT INTO public.hvr_workspace_setups(environment,id,base_id,state) VALUES($1,$2,$3,'review')
    ON CONFLICT DO NOTHING RETURNING id`,
    [c.APP_ENV, id, data.credentials.AIRTABLE_BASE_ID],
  );
  if (!reserved.rows.length)
    throw new AppError(409, 'WORKSPACE_SETUP_REVIEW', 'มีคำขอสร้าง Space นี้แล้ว กรุณาตรวจผลเดิม');
  try {
    const spaceRecord = await control.spaces.upsert('users', 'Workspace ID', {
      'Workspace ID': id,
      Name: data.name,
      'Base ID': data.credentials.AIRTABLE_BASE_ID,
      Active: false,
    });
    await atomic(root, async (db) => {
      await db.query(
        'INSERT INTO public.hvr_workspaces(environment,id,name,schema_name,base_id,control_id,credentials,active) VALUES($1,$2,$3,$4,$5,$6,$7,false)',
        [
          c.APP_ENV,
          id,
          data.name,
          schemaName,
          data.credentials.AIRTABLE_BASE_ID,
          spaceRecord.id,
          encrypted,
        ],
      );
      await createOperationalSchema(db, schemaName, c.APP_ENV, data.credentials.AIRTABLE_BASE_ID);
    });
    const admin = await provisionMember(
      control,
      candidate,
      spaceRecord.id,
      id,
      data.adminEmail,
      'Admin',
      true,
    );
    await control.requireAdmin(spaceRecord.id, (admin.fields.User as string[])[0]);
    await control.spaces.patch('users', spaceRecord.id, { Active: true });
    await atomic(root, async (db) => {
      await db.query(
        'UPDATE public.hvr_workspaces SET active=true WHERE environment=$1 AND id=$2',
        [c.APP_ENV, id],
      );
      await audit(db, c, id, actor.id, 'created');
      await db.query(
        "UPDATE public.hvr_workspace_setups SET state='complete' WHERE environment=$1 AND id=$2",
        [c.APP_ENV, id],
      );
    });
    return { id };
  } catch {
    throw new AppError(
      503,
      'WORKSPACE_SETUP_REVIEW',
      'การสร้าง Space ยังไม่สมบูรณ์ กรุณาให้เจ้าของระบบตรวจรายการที่พักไว้ก่อนสร้างซ้ำ',
    );
  }
}
export async function provisionMember(
  control: ControlPlane,
  raw: AirtableRepository,
  spaceRecord: string,
  spaceId: string,
  email: string,
  role: User['role'],
  active: boolean,
  name?: string,
) {
  email = z.email().parse(email).toLowerCase();
  const users = (await control.users.list('users', `LOWER({Email})=${formulaValue(email)}`)).filter(
    (u) => String(u.fields.Email || '').toLowerCase() === email,
  );
  if (users.length > 1)
    throw new AppError(409, 'WORKSPACE_DUPLICATE_USER', 'พบอีเมลซ้ำ กรุณาให้เจ้าของระบบตรวจสอบ');
  const central =
    users[0] ||
    (await control.users.upsert('users', 'User ID', {
      'User ID': 'GLOBAL-' + hash(email).slice(0, 32),
      Email: email,
      'Full Name': name || email,
      Role: 'Agent',
      Active: true,
    }));
  const localUsers = (await raw.list('users', `LOWER({Email})=${formulaValue(email)}`)).filter(
    (u) => String(u.fields.Email || '').toLowerCase() === email,
  );
  if (localUsers.length > 1)
    throw new AppError(409, 'WORKSPACE_DUPLICATE_USER', 'พบอีเมลซ้ำใน Base ของ Space');
  const local =
    localUsers[0] ||
    (await raw.upsert('users', 'User ID', {
      'User ID': 'MEM-' + central.id,
      Email: email,
      'Full Name': String(central.fields['Full Name'] || email),
      Role: role,
      Active: active,
    }));
  const member = await control.members.upsert('users', 'Membership Key', {
    'Membership Key': spaceId + ':' + central.id,
    Workspace: [spaceRecord],
    User: [central.id],
    'Local User ID': local.id,
    Role: role,
    Active: active,
  });
  return member;
}
export async function updateMember(
  root: Sql,
  c: Config,
  control: ControlPlane,
  actor: User,
  id: string,
  input: unknown,
) {
  const data = z
    .object({
      email: z.email(),
      role: z.enum(roles),
      active: z.boolean(),
      name: z.string().trim().max(120).optional(),
    })
    .strict()
    .parse(input);
  const space = await spaceServices(root, c, control, id);
  await control.requireAdmin(space.row.control_id, actor.id);
  return atomic(root, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      c.APP_ENV + ':' + id + ':members',
    ]);
    const scopedControl = control.withDatabase(db);
    await scopedControl.requireAdmin(space.row.control_id, actor.id);
    const members = await scopedControl.roster(space.row.control_id);
    const users = await scopedControl.memberUsers(members);
    const target = members.find(
      (_m, i) => String(users[i].fields.Email || '').toLowerCase() === data.email.toLowerCase(),
    );
    if (
      target?.active &&
      target.role === 'Admin' &&
      (!data.active || data.role !== 'Admin') &&
      members.filter((m, i) => m.active && m.role === 'Admin' && users[i].fields.Active === true)
        .length <= 1
    )
      throw new AppError(409, 'LAST_WORKSPACE_ADMIN', 'ต้องมี Admin ที่ใช้งานได้อย่างน้อยหนึ่งคนใน Space');
    await provisionMember(
      scopedControl,
      scopedControl.repository(space.config, db),
      space.row.control_id,
      id,
      data.email,
      data.role,
      data.active,
      data.name,
    );
    await audit(db, c, id, actor.id, 'member-updated');
    return { saved: true };
  });
}
export async function enrollMember(
  root: Sql,
  c: Config,
  control: ControlPlane,
  spaceId: string,
  user: User,
  name: string,
) {
  const space = await spaceServices(root, c, control, spaceId);
  return atomic(root, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      c.APP_ENV + ':' + spaceId + ':members',
    ]);
    const scopedControl = control.withDatabase(db);
    const members = (await scopedControl.roster(space.row.control_id)).filter(
      (m) => m.user === user.id,
    );
    if (members.length > 1) throw forbidden();
    if (members.length)
      return members[0].active && user.active ? ('existing' as const) : ('pending' as const);
    await provisionMember(
      scopedControl,
      scopedControl.repository(space.config, db),
      space.row.control_id,
      spaceId,
      user.email,
      'Agent',
      false,
      name,
    );
    return 'pending' as const;
  });
}
export async function audit(db: Sql, c: Config, id: string, actor: string, action: string) {
  await db.query(
    'INSERT INTO public.hvr_workspace_events(environment,workspace_id,actor,action) VALUES($1,$2,$3,$4)',
    [c.APP_ENV, id, actor, action],
  );
}
