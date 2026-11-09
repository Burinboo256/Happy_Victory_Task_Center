import { onboardingWrite, templateRead } from '@/server/onboarding-route';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = templateRead;
export function POST(request: Request) {
  return onboardingWrite(request);
}
