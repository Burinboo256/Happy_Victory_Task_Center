import { onboardingWrite } from '@/server/onboarding-route';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return onboardingWrite(request, (await context.params).id);
}
