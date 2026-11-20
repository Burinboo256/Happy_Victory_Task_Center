import { timingSafeEqual } from 'node:crypto';
import { services } from '@/server/context';
import { route, json } from '@/server/http';
import { AppError } from '@/server/errors';
import { drainLineQueue } from '@/server/line/queue';
import { drainSpaceQueue } from '@/server/workspaces/line-routing';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export function GET(request: Request) {
  return route(async () => {
    const c = await services();
    const expected = 'Bearer ' + (c.config.CRON_SECRET || '');
    const provided = request.headers.get('authorization') || '';
    if (
      !c.config.CRON_SECRET ||
      provided.length !== expected.length ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    )
      throw new AppError(401, 'CRON_AUTH', 'ไม่ได้รับอนุญาต');
    if (c.control) {
      // One Space per tick keeps the job within the hosting time limit; rotate fairly.
      const row = (
        await c.db.query(
          `WITH next AS (SELECT id FROM public.hvr_workspaces
        WHERE environment=$1 AND active ORDER BY last_drained_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
        UPDATE public.hvr_workspaces w SET last_drained_at=clock_timestamp() FROM next n
        WHERE w.environment=$1 AND w.id=n.id RETURNING w.id`,
          [c.config.APP_ENV],
        )
      ).rows[0];
      return json(
        row ? await drainSpaceQueue(c.db, c.config, c.control, row.id) : { processed: 0 },
      );
    }
    return json(await drainLineQueue(c.db, c.config, c.repo));
  });
}
