import { z } from 'zod';
import { protectedContext } from './context';
import { requireCsrf } from './auth/security';
import { readBody, route, json } from './http';
import { requireWrites } from './runtime';
import { Journal } from './operations/journal';
import { mutate, validateMutation, type Action } from './services/mutations';
import { ownTask } from './services/reads';
import { requireTaskReady } from './operations/task-ready';
import { requireWorkflowComplete } from './services/onboarding';

export function mutationRoute(
  request: Request,
  action: Action,
  parameters: Record<string, string> = {},
) {
  return route(async () => {
    const c = await protectedContext();
    requireCsrf(request, c.csrfToken, c.config);
    await requireWrites(c.db, c.config);
    const requestId = z.uuid().parse(request.headers.get('idempotency-key'));
    const body = z.record(z.string(), z.unknown()).parse(await readBody(request));
    const data = validateMutation(action, { ...body, ...parameters }, c.user);
    if (action !== 'create' && 'id' in data) {
      await ownTask(c.repo, c.user, data.id);
      await requireTaskReady(c.db, c.config, c.repo, data.id);
    }
    const resource =
      action === 'create' ? 'create:' + c.user.id + ':' + requestId : 'task:' + parameters.id;
    const outcome = await new Journal(c.db, c.config).execute(
      c.user.id,
      requestId,
      action,
      data,
      resource,
      async (steps) => {
        if (action === 'status' && 'status' in data && data.status === 'Completed')
          await requireWorkflowComplete(c.db, c.config, c.repo, c.user, parameters.id);
        return mutate(c.repo, c.user, action, data, steps);
      },
    );
    if (outcome.result?.id) await ownTask(c.repo, c.user, outcome.result.id);
    return json(
      { operationId: outcome.operationId, state: outcome.state, ...(outcome.result || {}) },
      outcome.state === 'completed' ? 200 : 202,
    );
  });
}
