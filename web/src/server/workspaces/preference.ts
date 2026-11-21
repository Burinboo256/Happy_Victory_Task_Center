import type { User } from '../../domain/model';
import type { Config } from '../config';
import type { Sql } from '../db';
import { AppError, forbidden } from '../errors';
import type { ControlPlane } from './control';
import { authorizeSpace } from './service';
import { safeReturnTo } from '../auth/security';

export async function rememberSpace(
  db: Sql,
  config: Config,
  control: ControlPlane,
  user: User,
  id: string,
) {
  if (!user.active || !user.sub) throw forbidden();
  const context = await authorizeSpace(db, config, control, user, id);
  await db.query(
    `INSERT INTO public.hvr_workspace_preferences(environment,user_id,subject,workspace_id)
    VALUES($1,$2,$3,$4) ON CONFLICT(environment,user_id) DO UPDATE
    SET subject=EXCLUDED.subject,workspace_id=EXCLUDED.workspace_id,updated_at=clock_timestamp()`,
    [config.APP_ENV, user.id, user.sub, context.row.id],
  );
  return context;
}

// An explicit session selection wins. A missing cookie may resume the account's preference.
// Always reauthorize; paused/revoked Spaces go to the chooser, outages remain errors.
export async function resumeSpace(
  db: Sql,
  config: Config,
  control: ControlPlane,
  user: User,
  selected?: string,
) {
  if (!user.active || !user.sub) throw forbidden();
  const id =
    selected ||
    (
      await db.query<{ workspace_id: string }>(
        `SELECT workspace_id FROM public.hvr_workspace_preferences
        WHERE environment=$1 AND user_id=$2 AND subject=$3`,
        [config.APP_ENV, user.id, user.sub],
      )
    ).rows[0]?.workspace_id;
  if (!id) return undefined;
  try {
    return await authorizeSpace(db, config, control, user, id);
  } catch (error) {
    if (error instanceof AppError && [403, 404].includes(error.status)) return undefined;
    throw error;
  }
}

export function spaceLoginDestination(returnTo: string, enabled: boolean, selected?: string) {
  const target = safeReturnTo(returnTo);
  // Explicit chooser and Space-specific links keep their original destination.
  return enabled && !selected && target === '/' ? '/spaces' : target;
}
