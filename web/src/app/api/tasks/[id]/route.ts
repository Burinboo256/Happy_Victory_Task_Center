import { protectedContext } from '@/server/context';
import { detail } from '@/server/services/reads';
import { route, json } from '@/server/http';
import { readWorkflow } from '@/server/services/onboarding';
import { onboardingCategory } from '@/domain/onboarding';
import { isManager } from '@/domain/model';
import { readCaseWorkflow } from '@/server/services/case-workflow';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const c = await protectedContext();
    const result = await detail(c.repo, c.user, (await context.params).id);
    const legacy =
      result.task.category === onboardingCategory &&
      (
        await c.db.query('SELECT 1 FROM hvr_workflows WHERE environment=$1 AND resource=$2', [
          c.config.APP_ENV,
          'task:' + result.task.id,
        ])
      ).rows.length > 0;
    const workflow = legacy
      ? await readWorkflow(c.db, c.config, result.task.id, isManager(c.user))
      : undefined;
    const caseWorkflow = await readCaseWorkflow(c.db, c.config, result.task, isManager(c.user));
    if (caseWorkflow && isManager(c.user))
      result.task.followupDate =
        [result.task.followupDate, caseWorkflow.summary.nextDate].filter(Boolean).sort()[0] || '';
    return json({ ...result, workflow, caseWorkflow });
  });
}
