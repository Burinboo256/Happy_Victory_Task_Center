import { z } from 'zod';
import { services } from '@/server/context';
import { json, readBody, route } from '@/server/http';
import { replyAi } from '@/server/ai/line';
import { replySpaceAi } from '@/server/workspaces/line-routing';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const input = z
  .object({ ticket: z.string().regex(/^[a-f0-9]{64}$/), text: z.string().max(16000) })
  .strict();
export function POST(request: Request) {
  return route(async () => {
    const c = await services();
    const body = input.parse(await readBody(request));
    if (c.control)
      return json(await replySpaceAi(c.db, c.config, c.control, body.ticket, body.text));
    return json(await replyAi(c.db, c.config, c.repo, body.ticket, body.text));
  });
}
