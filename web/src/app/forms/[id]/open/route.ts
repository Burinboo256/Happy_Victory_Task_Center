import { NextResponse } from 'next/server';
import { protectedContext } from '@/server/context';
import { publishedDocument } from '@/server/documents/service';
import { AppError } from '@/server/errors';
import { failure } from '@/server/http';
import { readConfig } from '@/server/config';
import { z } from 'zod';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  try {
    z.uuid().parse(id);
    const c = await protectedContext();
    const doc = await publishedDocument(c.db, c.config, c.user, id);
    const response = NextResponse.redirect(doc.version.data.url, 307);
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  } catch (error) {
    if (error instanceof AppError && error.status === 401) {
      const url = new URL('/login', readConfig().APP_ORIGIN);
      url.searchParams.set('returnTo', `/forms/${id}/open`);
      const response = NextResponse.redirect(url, 307);
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
    return failure(error);
  }
}
