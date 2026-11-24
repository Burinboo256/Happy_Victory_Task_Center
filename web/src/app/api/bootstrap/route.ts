import { bootstrap } from '@/server/services/reads';
import { runtimeState } from '@/server/runtime';
import { json } from '@/server/http';
import { readRoute } from '@/server/read-route';
import { taskDetail } from '@/server/services/task-detail';
import { recordId } from '@/server/airtable/client';
import { z } from 'zod';
import { attachCaseSummaries } from '@/server/services/case-workflow';
import { isManager } from '@/domain/model';
import { after } from 'next/server';
import { safelyDrainLineQueue } from '@/server/line/queue';
import { rememberAuthorizedSpace } from '@/server/workspaces/preference';
import { workspaceCookie } from '@/server/workspaces/service';
import { cookieOptions } from '@/server/auth/security';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export function GET(request: Request) {
  return readRoute(async (c) => {
    const params = new URL(request.url).searchParams;
    const taskId = params.has('taskId') ? recordId(params.get('taskId') || '') : undefined;
    const state = await runtimeState(c.db, c.config);
    const scope = z.enum(['full', 'context']).parse(params.get('scope') || 'full');
    // Check task ownership before loading the rest of the detail page.
    const detail = taskId ? await taskDetail(c, taskId) : undefined;
    const data = await bootstrap(c.repo, c.user, taskId ? 'context' : scope);
    if (isManager(c.user)) data.tasks = await attachCaseSummaries(c.db, c.config, data.tasks);
    if (isManager(c.user) && c.config.ENABLE_LINE_NOTIFICATIONS)
      after(() => safelyDrainLineQueue(c.db, c.config, c.repo));
    const response = json({
      ...data,
      csrfToken: c.csrfToken,
      writesEnabled: state.writes,
      formsEnabled: c.config.FORMS_ENABLED,
      workspace: c.config.workspace,
      ...(detail ? { detail } : {}),
    });
    if (request.headers.has('x-workspace-slug') && c.config.workspace) {
      await rememberAuthorizedSpace(c.rootDb, c.config, c.globalUser, c.config.workspace.id);
      response.cookies.set(
        workspaceCookie(c.config),
        c.config.workspace.id,
        cookieOptions(c.config, 21600),
      );
    }
    return response;
  });
}
