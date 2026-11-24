import { cookies, headers } from 'next/headers';
import { readConfig } from './config';
import { getPool, type Sql } from './db';
import { AirtableClient } from './airtable/client';
import { authenticate } from './auth/session';
import { cookieName } from './auth/security';
import { ControlPlane } from './workspaces/control';
import { modeGuard, workspaceCookie, workspaceCsrf } from './workspaces/service';
import { requestSpace } from './workspaces/request';
import { AppError } from './errors';
import type { RequestReadScope } from './airtable/read-scope';

export async function services(readScope?: RequestReadScope) {
  const config = readConfig();
  const db: Sql = getPool(config);
  await modeGuard(db, config);
  const control = config.WORKSPACES_ENABLED
    ? new ControlPlane(config, db, undefined, readScope)
    : undefined;
  const raw = control?.users || new AirtableClient(config, db);
  return { config, db, repo: control ? raw : readScope?.wrap(raw) || raw, control };
}
export async function protectedIdentity(readScope?: RequestReadScope) {
  const context = await services(readScope);
  const token = (await cookies()).get(cookieName(context.config, 'session'))?.value;
  return {
    ...context,
    ...(await authenticate(context.db, context.repo, context.config, token)),
    token: token || '',
  };
}
export async function protectedContext(explicitSlug?: string, readScope?: RequestReadScope) {
  const identity = await protectedIdentity(readScope);
  const requestHeaders = await headers();
  const slug = explicitSlug ?? requestHeaders.get('x-workspace-slug') ?? undefined;
  if (!identity.control) {
    if (slug !== undefined) throw new AppError(403, 'WORKSPACE_REQUIRED', 'ยังไม่เปิดใช้งาน Space');
    return { ...identity, rootDb: identity.db, globalUser: identity.user };
  }
  const selected = (await cookies()).get(workspaceCookie(identity.config))?.value;
  const context = await requestSpace(
    identity.db,
    identity.config,
    identity.control,
    identity.user,
    selected,
    slug,
    requestHeaders.get('x-workspace-id') || undefined,
  );
  return {
    ...identity,
    ...context,
    rootDb: identity.db,
    globalUser: identity.user,
    csrfToken: workspaceCsrf(identity.csrfToken, context.row.id),
  };
}
