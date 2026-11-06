import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { services } from '@/server/context';
import { finishGoogle, GoogleLoginError } from '@/server/auth/google';
import { failure } from '@/server/http';
import { cookieName, cookieOptions, readBinding } from '@/server/auth/security';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  let c: ReturnType<typeof services>;
  try {
    c = services();
  } catch (error) {
    return failure(error);
  }
  try {
    const binding = readBinding(
      (await cookies()).get(cookieName(c.config, 'oauth'))?.value,
      c.config.AUTH_SECRET,
    );
    const result = await finishGoogle(c.db, c.repo, c.config, new URL(request.url), binding);
    const response = NextResponse.redirect(new URL(result.returnTo, c.config.APP_ORIGIN), 303);
    response.cookies.set(
      cookieName(c.config, 'session'),
      result.token,
      cookieOptions(c.config, 21600),
    );
    response.cookies.set(cookieName(c.config, 'oauth'), '', cookieOptions(c.config, 0));
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    const login = new URL('/login?error=google', c.config.APP_ORIGIN);
    if (error instanceof GoogleLoginError) login.searchParams.set('returnTo', error.returnTo);
    const response = NextResponse.redirect(login, 303);
    response.cookies.set(cookieName(c.config, 'oauth'), '', cookieOptions(c.config, 0));
    return response;
  }
}
