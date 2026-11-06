import { mutationRoute } from '@/server/mutation-route';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return mutationRoute(request, 'followup', await context.params);
}
