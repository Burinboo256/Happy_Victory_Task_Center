import { z } from 'zod';
import { protectedContext } from '@/server/context';
import { json, readBody, route } from '@/server/http';
import { requireCsrf } from '@/server/auth/security';
import { requireWrites } from '@/server/runtime';
import { aiLinkState, startAiLink, confirmAiLink, disconnectAi } from '@/server/ai/line';
import { registerLineCode, selectAiSpace, aiSpaceSelected } from '@/server/workspaces/line-routing';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }),
  z.object({ action: z.literal('confirm'), candidateId: z.string() }),
  z.object({ action: z.literal('disconnect') }),
  z.object({ action: z.literal('select-workspace') }),
]);
export function GET() {
  return route(async () => {
    const c = await protectedContext();
    return json({
      ...(await aiLinkState(c.db, c.config, c.user)),
      workspace: c.config.workspace,
      selected: await aiSpaceSelected(c.rootDb, c.db, c.config, c.user),
    });
  });
}
export function POST(request: Request) {
  return route(async () => {
    const c = await protectedContext();
    requireCsrf(request, c.csrfToken, c.config);
    await requireWrites(c.db, c.config);
    const body = input.parse(await readBody(request));
    if (body.action === 'start') {
      const link = await startAiLink(c.db, c.config, c.user);
      await registerLineCode(c.rootDb, c.config, 'ai', link.code);
      return json(link);
    }
    if (body.action === 'confirm') {
      await confirmAiLink(c.db, c.config, c.user, body.candidateId);
      await selectAiSpace(c.rootDb, c.db, c.config, c.user);
    } else if (body.action === 'select-workspace')
      await selectAiSpace(c.rootDb, c.db, c.config, c.user);
    else await disconnectAi(c.db, c.config, c.user);
    return json({ saved: true });
  });
}
