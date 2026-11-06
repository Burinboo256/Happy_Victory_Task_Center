import { mutationRoute } from '@/server/mutation-route';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; followupId: string }> },
) {
  return mutationRoute(request, 'resolveFollowup', await context.params);
}
