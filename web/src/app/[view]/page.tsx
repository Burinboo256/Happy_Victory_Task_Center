import { notFound } from 'next/navigation';
import { Workspace, type Page } from '@/components/workspace';
export default async function View({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  if (
    !['inbox', 'followups', 'calendar', 'reports', 'team', 'history', 'notifications'].includes(
      view,
    )
  )
    notFound();
  return <Workspace page={view as Page} />;
}
