import { timingSafeEqual } from 'node:crypto';
import { services } from '@/server/context';
import { route, json } from '@/server/http';
import { AppError } from '@/server/errors';
import { drainLineQueue } from '@/server/line/queue';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export function GET(request: Request) {
  return route(async () => {
    const c = services();
    const expected = 'Bearer ' + (c.config.CRON_SECRET || '');
    const provided = request.headers.get('authorization') || '';
    if (
      !c.config.CRON_SECRET ||
      provided.length !== expected.length ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    )
      throw new AppError(401, 'CRON_AUTH', 'ไม่ได้รับอนุญาต');
    return json(await drainLineQueue(c.db, c.config, c.repo));
  });
}
