import { z } from 'zod';
import { protectedContext } from '@/server/context';
import { requireCsrf } from '@/server/auth/security';
import { route, json, readBody } from '@/server/http';
import { requireWrites } from '@/server/runtime';
import { requireTaskReady } from '@/server/operations/task-ready';
import { Journal } from '@/server/operations/journal';
import { caseInput, saveCaseWorkflow } from '@/server/services/case-workflow';
import { isManager } from '@/domain/model';
import { forbidden } from '@/server/errors';
import { validateCaseState } from '@/domain/case-workflow';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const c = await protectedContext();
    if (!isManager(c.user)) throw forbidden();
    requireCsrf(request, c.csrfToken, c.config);
    await requireWrites(c.db, c.config);
    const id = z
      .string()
      .regex(/^rec[a-zA-Z0-9]{14}$/)
      .parse((await context.params).id);
    const key = z.uuid().parse(request.headers.get('idempotency-key'));
    const data = caseInput.parse(await readBody(request));
    data.state = validateCaseState(data.state);
    await requireTaskReady(c.db, c.config, c.repo, id);
    const result = await new Journal(c.db, c.config).execute(
      c.user.id,
      key,
      'case-workflow',
      data,
      'task:' + id,
      (steps) =>
        steps.run(
          'workflow-sql',
          () => saveCaseWorkflow(c.db, c.config, c.repo, c.user, id, data, steps.key),
          false,
        ),
    );
    return json(
      { operationId: result.operationId, state: result.state, ...result.result },
      result.state === 'completed' ? 200 : 202,
    );
  });
}
