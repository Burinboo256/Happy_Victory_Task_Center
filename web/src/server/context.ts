import { cookies, headers } from 'next/headers';
import { readConfig } from './config';
import { getPool, type Sql } from './db';
import { AirtableClient } from './airtable/client';
import { authenticate } from './auth/session';
import { cookieName } from './auth/security';
import { ControlPlane } from './workspaces/control';
import { authorizeSpace, modeGuard, workspaceCookie, workspaceCsrf } from './workspaces/service';
import { AppError } from './errors';

export async function services() {
  const config = readConfig();
  const db: Sql = getPool(config);
  await modeGuard(db, config);
  const control = config.WORKSPACES_ENABLED ? new ControlPlane(config, db) : undefined;
  return { config, db, repo: control?.users || new AirtableClient(config, db), control };
}
export async function protectedIdentity() {
  const context = await services();
  const token = (await cookies()).get(cookieName(context.config, 'session'))?.value;
  return {
    ...context,
    ...(await authenticate(context.db, context.repo, context.config, token)),
    token: token || '',
  };
}
export async function protectedContext() {
  const identity = await protectedIdentity();
  if (!identity.control) return { ...identity, rootDb: identity.db, globalUser: identity.user };
  const selected = (await cookies()).get(workspaceCookie(identity.config))?.value;
  if (!selected) throw new AppError(403, 'WORKSPACE_REQUIRED', 'กรุณาเลือก Space ก่อนเปิดงาน');
  const context = await authorizeSpace(
    identity.db,
    identity.config,
    identity.control,
    identity.user,
    selected,
  );
  const expected = (await headers()).get('x-workspace-id');
  if (expected && expected !== context.row.id)
    throw new AppError(409, 'WORKSPACE_CHANGED', 'Space เปลี่ยนแล้ว กรุณาเลือก Space และเปิดหน้าใหม่');
  return {
    ...identity,
    ...context,
    rootDb: identity.db,
    globalUser: identity.user,
    csrfToken: workspaceCsrf(identity.csrfToken, context.row.id),
  };
}
