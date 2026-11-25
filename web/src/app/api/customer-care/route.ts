import { protectedContext } from '@/server/context';
import { requireCsrf } from '@/server/auth/security';
import { json, route, readBody } from '@/server/http';
import { AppError } from '@/server/errors';
import { careRoster, careAlerts, saveCare } from '@/server/services/customer-care';
export const dynamic = 'force-dynamic';
async function context() {
  const c = await protectedContext();
  if (c.config.APP_ENV === 'production' || !c.config.workspace)
    throw new AppError(404, 'CARE_DISABLED', 'ยังไม่เปิดบริการใน Space นี้');
  return c;
}
export function GET(request: Request) {
  return route(async () => {
    const c = await context();
    return json(
      new URL(request.url).searchParams.get('scope') === 'alerts'
        ? await careAlerts(c)
        : await careRoster(c),
    );
  });
}
export function POST(request: Request) {
  return route(async () => {
    const c = await context();
    requireCsrf(request, c.csrfToken, c.config);
    return json(await saveCare(c, await readBody(request)));
  });
}
