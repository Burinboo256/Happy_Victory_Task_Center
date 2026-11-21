import { SpaceHub } from '@/components/space-hub';
import { safeReturnTo } from '@/server/auth/security';
import { isSpaceSlug } from '@/domain/space-link';
export default async function OpenSpace({
  searchParams,
}: {
  searchParams: Promise<{ space?: string; next?: string }>;
}) {
  const params = await searchParams;
  const next =
    params.next?.startsWith('/spaces') ||
    (params.next?.startsWith('/') && isSpaceSlug(params.next.slice(1)))
      ? '/'
      : safeReturnTo(params.next);
  return <SpaceHub target={params.space} next={next} />;
}
