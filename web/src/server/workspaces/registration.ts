import type { Sql } from '../db';
import type { Config } from '../config';
import type { ControlPlane } from './control';
import { spaceServices } from './service';
import { isSpaceSlug } from '../../domain/space-link';
import { AppError } from '../errors';

// Public signup resolves only the explicit link, never a session cookie or preference.
export async function registrationSpace(
  db: Sql,
  config: Config,
  control: ControlPlane,
  id?: string,
  slug?: string,
) {
  if (slug !== undefined) {
    if (!isSpaceSlug(slug)) throw new AppError(404, 'SPACE_NOT_FOUND', 'ไม่พบ Space นี้');
    id = (
      await db.query<{ id: string }>(
        'SELECT id FROM public.hvr_workspaces WHERE environment=$1 AND slug=$2',
        [config.APP_ENV, slug],
      )
    ).rows[0]?.id;
    if (!id) throw new AppError(404, 'SPACE_NOT_FOUND', 'ไม่พบ Space นี้');
  }
  return spaceServices(db, config, control, id);
}
