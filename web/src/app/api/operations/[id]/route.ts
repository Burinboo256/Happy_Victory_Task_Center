import { z } from 'zod';
import { protectedContext } from '@/server/context';
import { route, json } from '@/server/http';
import { AppError } from '@/server/errors';
import { ownTask } from '@/server/services/reads';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const c = await protectedContext(),
      id = z.uuid().parse((await context.params).id);
    const result = await c.db.query(
      'SELECT id,state,result,error_code,resource FROM hvr_operations WHERE environment=$1 AND id=$2 AND user_id=$3',
      [c.config.APP_ENV, id, c.user.id],
    );
    const row = result.rows[0];
    if (!row) throw new AppError(404, 'NOT_FOUND', 'ไม่พบคำขอนี้');
    const taskId =
      row.result?.id || (row.resource.startsWith('task:') ? row.resource.slice(5) : '');
    if (taskId) await ownTask(c.repo, c.user, taskId);
    return json({
      operationId: row.id,
      state: row.state,
      ...(row.result || {}),
      errorCode: row.error_code,
    });
  });
}
