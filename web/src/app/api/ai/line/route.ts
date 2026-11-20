import { z } from 'zod';
import { services } from '@/server/context';
import { json, readBody, route } from '@/server/http';
import { receiveAi } from '@/server/ai/line';
import { after } from 'next/server';
import { safelyDrainLineQueue } from '@/server/line/queue';
import { receiveSpaceAi, drainSpaceQueue } from '@/server/workspaces/line-routing';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const input = z.object({ raw: z.string().max(28000), signature: z.string().max(100) }).strict();
export function POST(request: Request) {
  return route(async () => {
    const c = await services();
    const body = input.parse(await readBody(request));
    if (c.control) {
      const result = await receiveSpaceAi(c.db, c.config, c.control, body.raw, body.signature);
      const control = c.control;
      if (result.confirmedSpaces.length && c.config.ENABLE_LINE_NOTIFICATIONS)
        after(async () => {
          for (const id of result.confirmedSpaces) {
            try {
              await drainSpaceQueue(c.db, c.config, control, id);
            } catch {
              console.error('workspace_line_drain_failed');
            }
          }
        });
      return json({ jobs: result.jobs, taskConfirmed: result.taskConfirmed });
    }
    const result = await receiveAi(c.db, c.config, c.repo, body.raw, body.signature);
    if (result.taskConfirmed && c.config.ENABLE_LINE_NOTIFICATIONS)
      after(() => safelyDrainLineQueue(c.db, c.config, c.repo));
    return json(result);
  });
}
