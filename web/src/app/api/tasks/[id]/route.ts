import { protectedContext } from '@/server/context';
import { detail } from '@/server/services/reads';
import { route, json } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const c = await protectedContext();
    return json(await detail(c.repo, c.user, (await context.params).id));
  });
}
