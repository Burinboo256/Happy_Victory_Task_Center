import { z } from 'zod';
import { protectedIdentity } from '@/server/context';
import { requireCsrf, cookieOptions } from '@/server/auth/security';
import { json, readBody, route } from '@/server/http';
import { AppError } from '@/server/errors';
import {
  authorizeSpace,
  createSpace,
  listSpaces,
  spaceServices,
  updateMember,
  workspaceCookie,
  audit,
  getSpace,
} from '@/server/workspaces/service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export function GET(request: Request) {
  return route(async () => {
    const c = await protectedIdentity();
    if (!c.control)
      return json({ enabled: false, items: [], owner: false, csrfToken: c.csrfToken });
    const id = new URL(request.url).searchParams.get('members');
    if (id) {
      const space = await spaceServices(c.db, c.config, c.control, id);
      await c.control.requireAdmin(space.row.control_id, c.user.id);
      const members = await c.control.roster(space.row.control_id);
      const users = await c.control.memberUsers(members);
      return json({
        members: members.map((m, i) => ({
          email: String(users[i].fields.Email || ''),
          name: String(users[i].fields['Full Name'] || ''),
          role: m.role,
          active: m.active,
          globallyActive: users[i].fields.Active === true,
        })),
      });
    }
    return json({
      enabled: true,
      ...(await listSpaces(c.db, c.config, c.control, c.user)),
      csrfToken: c.csrfToken,
    });
  });
}
export function POST(request: Request) {
  return route(async () => {
    const c = await protectedIdentity();
    requireCsrf(request, c.csrfToken, c.config);
    if (!c.control) throw new AppError(404, 'WORKSPACES_DISABLED', 'ยังไม่เปิดระบบ Space');
    const body = z
      .object({
        action: z.enum(['select', 'create', 'member', 'status']),
        id: z.uuid().optional(),
        data: z.unknown().optional(),
      })
      .strict()
      .parse(await readBody(request));
    if (body.action === 'create')
      return json(await createSpace(c.db, c.config, c.control, c.user, body.data));
    const id = z.uuid().parse(body.id);
    if (body.action === 'select') {
      await authorizeSpace(c.db, c.config, c.control, c.user, id);
      const response = json({ selected: id });
      response.cookies.set(workspaceCookie(c.config), id, cookieOptions(c.config, 21600));
      return response;
    }
    if (body.action === 'member')
      return json(await updateMember(c.db, c.config, c.control, c.user, id, body.data));
    await c.control.requireOwner(c.user.id);
    const row = await getSpace(c.db, c.config, id);
    const active = z.object({ active: z.boolean() }).strict().parse(body.data).active;
    await c.control.spaces.patch('users', row.control_id, { Active: active });
    await audit(c.db, c.config, id, c.user.id, active ? 'resumed' : 'paused');
    return json({ saved: true });
  });
}
