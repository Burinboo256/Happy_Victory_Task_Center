import { protectedContext } from '@/server/context';
import { bootstrap } from '@/server/services/reads';
import { runtimeState } from '@/server/runtime';
import { route, json } from '@/server/http';
import { z } from 'zod';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return route(async () => {
    const c = await protectedContext();
    const state = await runtimeState(c.db, c.config);
    const scope = z
      .enum(['full', 'context'])
      .parse(new URL(request.url).searchParams.get('scope') || 'full');
    return json({
      ...(await bootstrap(c.repo, c.user, scope)),
      csrfToken: c.csrfToken,
      writesEnabled: state.writes,
    });
  });
}
