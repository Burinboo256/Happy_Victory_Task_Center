import { protectedContext } from '@/server/context';
import { detail } from '@/server/services/reads';
import { route, json } from '@/server/http';
import { readWorkflow } from '@/server/services/onboarding';
import { onboardingCategory } from '@/domain/onboarding';
import { isManager } from '@/domain/model';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const c = await protectedContext();
    const result = await detail(c.repo, c.user, (await context.params).id);
    const workflow =
      result.task.category === onboardingCategory
        ? await readWorkflow(c.db, c.config, result.task.id, isManager(c.user))
        : undefined;
    if (workflow && isManager(c.user))
      result.task.followupDate =
        [result.task.followupDate, workflow.summary.nextDate].filter(Boolean).sort()[0] || '';
    return json({ ...result, workflow });
  });
}
