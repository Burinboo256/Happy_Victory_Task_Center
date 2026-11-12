import { z } from 'zod';
import { protectedContext } from '@/server/context';
import { json, readBody, route } from '@/server/http';
import { requireCsrf } from '@/server/auth/security';
import { requireWrites } from '@/server/runtime';
import {
  documentDetails,
  saveDocumentDraft,
  publishDocument,
  pauseDocument,
  favoriteDocument,
} from '@/server/documents/service';
import { documentInput } from '@/domain/documents';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ id: string }> };
const revision = z.number().int().positive();
const input = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('draft'),
      revision,
      versionId: z.uuid().nullable(),
      data: documentInput,
    })
    .strict(),
  z
    .object({ action: z.literal('publish'), revision, versionId: z.uuid(), reviewed: z.boolean() })
    .strict(),
  z.object({ action: z.literal('pause'), revision, paused: z.boolean() }).strict(),
  z.object({ action: z.literal('favorite'), favorite: z.boolean() }).strict(),
]);
export function GET(_request: Request, { params }: Params) {
  return route(async () => {
    const c = await protectedContext();
    return json(await documentDetails(c.db, c.config, c.user, (await params).id));
  });
}
export function POST(request: Request, { params }: Params) {
  return route(async () => {
    const c = await protectedContext();
    requireCsrf(request, c.csrfToken, c.config);
    await requireWrites(c.db, c.config);
    const id = (await params).id;
    const body = input.parse(await readBody(request));
    if (body.action === 'draft')
      return json(
        await saveDocumentDraft(
          c.db,
          c.config,
          c.user,
          id,
          body.revision,
          body.versionId,
          body.data,
        ),
      );
    if (body.action === 'publish')
      return json(
        await publishDocument(
          c.db,
          c.config,
          c.user,
          id,
          body.revision,
          body.versionId,
          body.reviewed,
        ),
      );
    if (body.action === 'pause')
      return json(await pauseDocument(c.db, c.config, c.user, id, body.revision, body.paused));
    await favoriteDocument(c.db, c.config, c.user, id, body.favorite);
    return json({ saved: true });
  });
}
