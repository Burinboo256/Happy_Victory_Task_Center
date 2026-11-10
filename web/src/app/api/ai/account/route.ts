import { z } from 'zod';
import { protectedContext } from '@/server/context';
import { json, readBody, route } from '@/server/http';
import { requireCsrf } from '@/server/auth/security';
import { requireWrites } from '@/server/runtime';
import { aiLinkState, startAiLink, confirmAiLink, disconnectAi } from '@/server/ai/line';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }),
  z.object({ action: z.literal('confirm'), candidateId: z.string() }),
  z.object({ action: z.literal('disconnect') }),
]);
export function GET() {
  return route(async () => {
    const c = await protectedContext();
    return json(await aiLinkState(c.db, c.config, c.user));
  });
}
export function POST(request: Request) {
  return route(async () => {
    const c = await protectedContext();
    requireCsrf(request, c.csrfToken, c.config);
    await requireWrites(c.db, c.config);
    const body = input.parse(await readBody(request));
    if (body.action === 'start') return json(await startAiLink(c.db, c.config, c.user));
    if (body.action === 'confirm') await confirmAiLink(c.db, c.config, c.user, body.candidateId);
    else await disconnectAi(c.db, c.config, c.user);
    return json({ saved: true });
  });
}
