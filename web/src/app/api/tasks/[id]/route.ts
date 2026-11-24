import { json } from '@/server/http';
import { readRoute } from '@/server/read-route';
import { taskDetail } from '@/server/services/task-detail';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return readRoute(async (c) => json(await taskDetail(c, (await context.params).id)));
}
