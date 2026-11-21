import { notFound } from 'next/navigation';
import { Workspace, type Page } from '@/components/workspace';
import { SpaceEntry } from '@/components/space-entry';
import { isSpaceSlug } from '@/domain/space-link';
export default async function View({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  if (
    !['inbox', 'followups', 'calendar', 'reports', 'team', 'history', 'notifications'].includes(
      view,
    )
  ) {
    if (isSpaceSlug(view)) return <SpaceEntry slug={view} />;
    notFound();
  }
  return <Workspace page={view as Page} />;
}
