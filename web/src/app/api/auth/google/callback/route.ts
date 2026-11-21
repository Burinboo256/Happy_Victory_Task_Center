import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { services } from '@/server/context';
import { finishGoogle, GoogleLoginError } from '@/server/auth/google';
import { failure } from '@/server/http';
import { cookieName, cookieOptions, readBinding } from '@/server/auth/security';
import { resumeSpace, spaceLoginDestination } from '@/server/workspaces/preference';
import { workspaceCookie } from '@/server/workspaces/service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  let c: Awaited<ReturnType<typeof services>>;
  try {
    c = await services();
  } catch (error) {
    return failure(error);
  }
  try {
    const binding = readBinding(
      (await cookies()).get(cookieName(c.config, 'oauth'))?.value,
      c.config.AUTH_SECRET,
    );
    const result = await finishGoogle(c.db, c.repo, c.config, new URL(request.url), binding);
    const space =
      result.kind === 'login' && c.control
        ? await resumeSpace(c.db, c.config, c.control, result.user)
        : undefined;
    const destination =
      result.kind === 'login'
        ? spaceLoginDestination(
            result.returnTo,
            !!c.config.WORKSPACES_ENABLED,
            space?.row.id,
            space?.row.slug,
          )
        : result.returnTo;
    const response = NextResponse.redirect(new URL(destination, c.config.APP_ORIGIN), 303);
    if (result.kind === 'login') {
      response.cookies.set(
        cookieName(c.config, 'session'),
        result.token,
        cookieOptions(c.config, 21600),
      );
      // Account switches must not inherit a previous user's Space cookie.
      response.cookies.set(
        workspaceCookie(c.config),
        space?.row.id || '',
        cookieOptions(c.config, space ? 21600 : 0),
      );
    }
    response.cookies.set(cookieName(c.config, 'oauth'), '', cookieOptions(c.config, 0));
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    const login = new URL(
      error instanceof GoogleLoginError && error.registration
        ? '/register?error=google'
        : '/login?error=google',
      c.config.APP_ORIGIN,
    );
    if (error instanceof GoogleLoginError) login.searchParams.set('returnTo', error.returnTo);
    if (error instanceof GoogleLoginError && error.registration && error.workspaceId)
      login.searchParams.set('space', error.workspaceId);
    const response = NextResponse.redirect(login, 303);
    response.cookies.set(cookieName(c.config, 'oauth'), '', cookieOptions(c.config, 0));
    return response;
  }
}
