import { protectedContext } from '@/server/context';
import { bootstrap } from '@/server/services/reads';
import { runtimeState } from '@/server/runtime';
import { route, json } from '@/server/http';
import { z } from 'zod';
import { attachWorkflowSummaries } from '@/server/services/onboarding';
import { isManager } from '@/domain/model';
import { after } from 'next/server';
import { safelyDrainLineQueue } from '@/server/line/queue';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export function GET(request: Request) {
  return route(async () => {
    const c = await protectedContext();
    const state = await runtimeState(c.db, c.config);
    const scope = z
      .enum(['full', 'context'])
      .parse(new URL(request.url).searchParams.get('scope') || 'full');
    const data = await bootstrap(c.repo, c.user, scope);
    if (isManager(c.user)) data.tasks = await attachWorkflowSummaries(c.db, c.config, data.tasks);
    if (isManager(c.user) && c.config.ENABLE_LINE_NOTIFICATIONS)
      after(() => safelyDrainLineQueue(c.db, c.config, c.repo));
    return json({
      ...data,
      csrfToken: c.csrfToken,
      writesEnabled: state.writes,
    });
  });
}
