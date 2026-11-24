import { z } from 'zod';
import type { User } from '../../domain/model';
import type { Config } from '../config';
import { atomic, type Sql } from '../db';
import { AppError } from '../errors';
import { type ControlPlane, isSystemOwner, lockMemberAdministration } from './control';
import { audit, spaceServices } from './service';

export async function listManagedMembers(
  db: Sql,
  c: Config,
  control: ControlPlane,
  actor: User,
  spaceId: string,
) {
  const space = await spaceServices(db, c, control, spaceId, await control.owner(actor.id));
  await control.requireAdmin(space.row.control_id, actor.id);
  const members = await control.roster(space.row.control_id);
  const users = await control.memberUsers(members);
  return members
    .map((m, i) => ({
      userId: m.user,
      email: String(users[i].fields.Email || ''),
      name: String(users[i].fields['Full Name'] || ''),
      role: isSystemOwner(users[i]) ? 'Admin' : m.role,
      active: isSystemOwner(users[i]) || m.active,
      systemOwner: users[i].fields['System Role'] === 'Owner',
      globallyActive: users[i].fields.Active === true,
      registeredAt: m.createdAt,
    }))
    .sort(
      (a, b) =>
        (b.registeredAt ? Date.parse(b.registeredAt) : 0) -
          (a.registeredAt ? Date.parse(a.registeredAt) : 0) ||
        a.email.localeCompare(b.email) ||
        a.userId.localeCompare(b.userId),
    );
}

export async function updateGlobalUserActive(
  root: Sql,
  c: Config,
  control: ControlPlane,
  actor: User,
  spaceId: string,
  input: unknown,
) {
  const data = z
    .object({ userId: z.string().regex(/^rec[A-Za-z0-9]{14}$/), active: z.boolean() })
    .strict()
    .parse(input);
  await control.requireOwner(actor.id);
  const space = await spaceServices(root, c, control, spaceId, true);
  return atomic(root, async (db) => {
    await lockMemberAdministration(db, c);
    const scoped = control.withDatabase(db);
    await scoped.requireOwner(actor.id);
    // Bind the action to the member shown in this panel, never a stale/mismatched target.
    await scoped.member(space.row.control_id, data.userId);
    const target = await scoped.users.get('users', data.userId);
    if (target.id === actor.id || target.fields['System Role'] === 'Owner')
      throw new AppError(409, 'SYSTEM_OWNER', 'ไม่สามารถเปิด–ปิดบัญชีเจ้าของระบบจากหน้านี้');
    if ((target.fields.Active === true) === data.active) return { saved: true };
    if (!data.active) {
      // Disabling a global account must not strand ANY Space with no active Admin.
      const memberships = await scoped.forUser(data.userId);
      for (const membership of memberships.filter((m) => m.active && m.role === 'Admin')) {
        const roster = await scoped.roster(membership.workspace);
        const users = await scoped.memberUsers(roster);
        if (
          !roster.some(
            (m, i) =>
              m.user !== data.userId &&
              m.active &&
              m.role === 'Admin' &&
              users[i].fields.Active === true,
          )
        )
          throw new AppError(
            409,
            'LAST_WORKSPACE_ADMIN',
            'บัญชีนี้เป็น Admin ที่ใช้งานได้คนสุดท้ายของบาง Space กรุณาเพิ่ม Admin คนอื่นก่อนปิดบัญชี',
          );
      }
    }
    await scoped.requireOwner(actor.id);
    await scoped.users.patch('users', target.id, { Active: data.active });
    await audit(
      db,
      c,
      spaceId,
      actor.id,
      `user-global-${data.active ? 'enabled' : 'disabled'}:${target.id}`,
    );
    return { saved: true };
  });
}
