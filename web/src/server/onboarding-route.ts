import { z } from 'zod';
import { protectedContext } from './context';
import { requireCsrf } from './auth/security';
import { readBody, route, json } from './http';
import { requireWrites } from './runtime';
import { Journal } from './operations/journal';
import { requireTaskReady } from './operations/task-ready';
import { isManager } from '../domain/model';
import { forbidden } from './errors';
import {
  workflowInput,
  templateInput,
  saveWorkflow,
  saveTemplate,
  readTemplate,
} from './services/onboarding';

export function onboardingWrite(request: Request, taskId?: string) {
  return route(async () => {
    const c = await protectedContext();
    if (taskId ? !isManager(c.user) : c.user.role !== 'Admin') throw forbidden();
    requireCsrf(request, c.csrfToken, c.config);
    await requireWrites(c.db, c.config);
    const requestId = z.uuid().parse(request.headers.get('idempotency-key'));
    if (taskId)
      z.string()
        .regex(/^rec[a-zA-Z0-9]{14}$/)
        .parse(taskId);
    const body = await readBody(request);
    const data = taskId ? workflowInput.parse(body) : templateInput.parse(body);
    if (taskId) await requireTaskReady(c.db, c.config, c.repo, taskId);
    const result = await new Journal(c.db, c.config).execute(
      c.user.id,
      requestId,
      taskId ? 'onboarding' : 'onboarding-template',
      data,
      taskId ? 'task:' + taskId : 'onboarding-template',
      (steps) =>
        steps.run(
          'workflow-sql',
          () =>
            taskId
              ? saveWorkflow(
                  c.db,
                  c.config,
                  c.repo,
                  c.user,
                  taskId,
                  workflowInput.parse(data),
                  steps.key,
                )
              : saveTemplate(c.db, c.config, c.user, templateInput.parse(data), steps.key),
          false,
        ),
    );
    return json(
      { operationId: result.operationId, state: result.state, ...result.result },
      result.state === 'completed' ? 200 : 202,
    );
  });
}
export function templateRead() {
  return route(async () => {
    const c = await protectedContext();
    if (c.user.role !== 'Admin') throw forbidden();
    return json(await readTemplate(c.db, c.config));
  });
}
