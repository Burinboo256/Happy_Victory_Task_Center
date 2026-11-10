import { z } from 'zod';
import { services } from '@/server/context';
import { json, readBody, route } from '@/server/http';
import { receiveAi } from '@/server/ai/line';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const input = z.object({ raw: z.string().max(28000), signature: z.string().max(100) }).strict();
export function POST(request: Request) {
  return route(async () => {
    const c = services();
    const body = input.parse(await readBody(request));
    return json(await receiveAi(c.db, c.config, c.repo, body.raw, body.signature));
  });
}
