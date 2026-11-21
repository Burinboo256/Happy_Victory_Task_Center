import type { Sql } from '../db';
import type { Config } from '../config';
import type { User } from '../../domain/model';
import type { ControlPlane } from './control';
import { isSpaceSlug } from '../../domain/space-link';
import { AppError } from '../errors';
import { resumeSpace } from './preference';

export async function requestSpace(
  db: Sql,
  config: Config,
  control: ControlPlane,
  user: User,
  selected?: string,
  slug?: string,
  expected?: string,
) {
  let id = selected;
  if (slug !== undefined) {
    if (!isSpaceSlug(slug)) throw new AppError(403, 'WORKSPACE_REQUIRED', 'ลิงก์ Space ไม่ถูกต้อง');
    id = (
      await db.query<{ id: string }>(
        'SELECT id FROM public.hvr_workspaces WHERE environment=$1 AND slug=$2',
        [config.APP_ENV, slug],
      )
    ).rows[0]?.id;
    if (!id) throw new AppError(403, 'WORKSPACE_REQUIRED', 'ไม่พบ Space ที่คุณเข้าถึงได้');
  }
  const context = await resumeSpace(db, config, control, user, id);
  if (!context) throw new AppError(403, 'WORKSPACE_REQUIRED', 'กรุณาเลือก Space ที่คุณเข้าถึงได้');
  if (expected && expected !== context.row.id)
    throw new AppError(409, 'WORKSPACE_CHANGED', 'Space ของคำขอไม่ตรงกับหน้าเว็บ กรุณาเปิดหน้าใหม่');
  return context;
}
