import { mutationRoute } from '@/server/mutation-route';
export const runtime = 'nodejs';
export const maxDuration = 60;
export function POST(request: Request) {
  return mutationRoute(request, 'create');
}
