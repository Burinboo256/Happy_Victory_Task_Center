import { NextResponse } from 'next/server';
import { protectedContext } from '@/server/context';
import { publishedDocument } from '@/server/documents/service';
import { AppError } from '@/server/errors';
import { failure } from '@/server/http';
import { readConfig } from '@/server/config';
import { z } from 'zod';
import { isSpaceSlug, spacePath } from '@/domain/space-link';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; view?: string }> },
) {
  const { id, view } = await params;
  try {
    z.uuid().parse(id);
    if (view !== undefined && !isSpaceSlug(view))
      throw new AppError(404, 'NOT_FOUND', 'ไม่พบเอกสาร');
    const c = await protectedContext(view);
    const doc = await publishedDocument(c.db, c.config, c.user, id);
    const response = NextResponse.redirect(doc.version.data.url, 307);
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  } catch (error) {
    if (error instanceof AppError && error.status === 401) {
      const url = new URL('/login', readConfig().APP_ORIGIN);
      url.searchParams.set('returnTo', spacePath(view, `/forms/${id}/open`));
      const response = NextResponse.redirect(url, 307);
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
    return failure(error);
  }
}
