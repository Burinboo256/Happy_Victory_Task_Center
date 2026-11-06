import { NextResponse } from 'next/server';
import { services } from '@/server/context';
import { startGoogle } from '@/server/auth/google';
import { cookieName, cookieOptions, signBinding, safeReturnTo } from '@/server/auth/security';
import { route } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return route(async () => {
    const c = services();
    try {
      const { url, binding } = await startGoogle(
        c.db,
        c.config,
        new URL(request.url).searchParams.get('returnTo'),
      );
      const response = NextResponse.redirect(url, 303);
      response.cookies.set(
        cookieName(c.config, 'oauth'),
        signBinding(binding, c.config.AUTH_SECRET),
        cookieOptions(c.config, 600),
      );
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    } catch {
      const login = new URL('/login?error=google', c.config.APP_ORIGIN);
      login.searchParams.set(
        'returnTo',
        safeReturnTo(new URL(request.url).searchParams.get('returnTo')),
      );
      return NextResponse.redirect(login, 303);
    }
  });
}
