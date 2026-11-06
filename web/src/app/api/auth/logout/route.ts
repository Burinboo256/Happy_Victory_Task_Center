import { cookies } from 'next/headers';
import { services } from '@/server/context';
import { hash, safeEqual, cookieName, cookieOptions } from '@/server/auth/security';
import { revokeSession } from '@/server/auth/session';
import { AppError } from '@/server/errors';
import { route, json } from '@/server/http';
export const runtime = 'nodejs';
export function POST(request: Request) {
  return route(async () => {
    const c = services();
    if (request.headers.get('origin') !== c.config.APP_ORIGIN)
      throw new AppError(403, 'CSRF', 'คำขอไม่ถูกต้อง');
    const token = (await cookies()).get(cookieName(c.config, 'session'))?.value;
    // Logout remains possible when the user's Airtable access was revoked.
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const result = await c.db.query(
        'SELECT csrf_token FROM hvr_sessions WHERE environment=$1 AND token_hash=$2',
        [c.config.APP_ENV, hash(token)],
      );
      if (
        result.rows[0] &&
        !safeEqual(request.headers.get('x-csrf-token') || '', result.rows[0].csrf_token)
      )
        throw new AppError(403, 'CSRF', 'คำขอไม่ถูกต้อง');
      await revokeSession(c.db, c.config, token);
    }
    const response = json({ ok: true });
    response.cookies.set(cookieName(c.config, 'session'), '', cookieOptions(c.config, 0));
    return response;
  });
}
