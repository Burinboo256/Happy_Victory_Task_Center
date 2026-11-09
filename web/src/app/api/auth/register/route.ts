import { services } from '@/server/context';
import { startGoogle } from '@/server/auth/google';
import { cookieName, cookieOptions, signBinding } from '@/server/auth/security';
import { registrationSchema } from '@/domain/registration';
import { requireWrites } from '@/server/runtime';
import { AppError } from '@/server/errors';
import { json, readBody, route } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function POST(request: Request) {
  return route(async () => {
    const c = services();
    if (request.headers.get('origin') !== c.config.APP_ORIGIN)
      throw new AppError(403, 'CSRF', 'กรุณาเริ่มลงทะเบียนจากหน้าเว็บนี้');
    const profile = registrationSchema.parse(await readBody(request));
    await requireWrites(c.db, c.config);
    const { url, binding } = await startGoogle(c.db, c.config, '/', undefined, profile);
    const response = json({ url: url.href });
    response.cookies.set(
      cookieName(c.config, 'oauth'),
      signBinding(binding, c.config.AUTH_SECRET),
      cookieOptions(c.config, 600),
    );
    return response;
  });
}
