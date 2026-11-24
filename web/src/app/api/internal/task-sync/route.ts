import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { readConfig } from '@/server/config';
import { services } from '@/server/context';
import { readBody, route, json } from '@/server/http';
import { AppError } from '@/server/errors';
import { spaceServices } from '@/server/workspaces/service';
import { drainTaskMirror } from '@/server/task-store/sync';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export function POST(request: Request) {
  return route(async () => {
    const config = readConfig();
    const expected = Buffer.from(`Bearer ${config.TASK_SYNC_SECRET || ''}`);
    const given = Buffer.from(request.headers.get('authorization') || '');
    if (
      !config.TASK_SYNC_SECRET ||
      expected.length !== given.length ||
      !timingSafeEqual(expected, given)
    )
      throw new AppError(401, 'SYNC_AUTH', 'ไม่ได้รับอนุญาต');
    const input = z
      .object({ workspaceId: z.uuid() })
      .strict()
      .parse(await readBody(request));
    const c = await services();
    if (!c.control) throw new AppError(409, 'SPACE_REQUIRED', 'ต้องระบุ Space');
    const space = await spaceServices(c.db, c.config, c.control, input.workspaceId);
    return json(await drainTaskMirror(space.db, space.config, space.rawRepo, 3));
  });
}
