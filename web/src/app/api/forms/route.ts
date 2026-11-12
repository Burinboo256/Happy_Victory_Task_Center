import { z } from 'zod';
import { protectedContext } from '@/server/context';
import { json, readBody, route } from '@/server/http';
import { requireCsrf } from '@/server/auth/security';
import { requireWrites } from '@/server/runtime';
import { createDocument, listDocuments } from '@/server/documents/service';
import { documentInput } from '@/domain/documents';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return route(async () => {
    const c = await protectedContext();
    return json(
      await listDocuments(
        c.db,
        c.config,
        c.user,
        Object.fromEntries(new URL(request.url).searchParams),
      ),
    );
  });
}
export function POST(request: Request) {
  return route(async () => {
    const c = await protectedContext();
    requireCsrf(request, c.csrfToken, c.config);
    await requireWrites(c.db, c.config);
    const body = z
      .object({ id: z.uuid(), data: documentInput })
      .strict()
      .parse(await readBody(request));
    return json(await createDocument(c.db, c.config, c.user, body.id, body.data), 201);
  });
}
