import { protectedContext } from '@/server/context';
import { requireCsrf } from '@/server/auth/security';
import { json, route, readBody } from '@/server/http';
import { AppError } from '@/server/errors';
import { careRoster, careAlerts, careDashboard, saveCare } from '@/server/services/customer-care';
export const dynamic = 'force-dynamic';
async function context() {
  const c = await protectedContext();
  if (!c.config.workspace) throw new AppError(404, 'CARE_DISABLED', 'ยังไม่เปิดบริการใน Space นี้');
  return c;
}
export function GET(request: Request) {
  return route(async () => {
    const c = await context();
    const scope = new URL(request.url).searchParams.get('scope');
    if (scope === 'access') return json({ authorized: true });
    if (scope === 'alerts') return json(await careAlerts(c));
    if (scope === 'dashboard') return json(await careDashboard(c));
    return json(await careRoster(c));
  });
}
export function POST(request: Request) {
  return route(async () => {
    const c = await context();
    requireCsrf(request, c.csrfToken, c.config);
    return json(await saveCare(c, await readBody(request)));
  });
}
