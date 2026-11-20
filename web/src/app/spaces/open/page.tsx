import { SpaceHub } from '@/components/space-hub';
import { safeReturnTo } from '@/server/auth/security';
export default async function OpenSpace({
  searchParams,
}: {
  searchParams: Promise<{ space?: string; next?: string }>;
}) {
  const params = await searchParams;
  const next = params.next?.startsWith('/spaces') ? '/' : safeReturnTo(params.next);
  return <SpaceHub target={params.space} next={next} />;
}
