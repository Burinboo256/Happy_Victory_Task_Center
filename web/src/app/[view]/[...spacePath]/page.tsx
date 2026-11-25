import { notFound, redirect } from 'next/navigation';
import { Workspace, type Page } from '@/components/workspace';
import { carePaths, isSpaceSlug, isWorkspacePath, spacePath } from '@/domain/space-link';
import { statuses } from '@/domain/model';

export default async function SpacePage({
  params,
  searchParams,
}: {
  params: Promise<{ view: string; spacePath: string[] }>;
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { view, spacePath: parts } = await params;
  const path = '/' + parts.join('/');
  if (!isSpaceSlug(view) || !isWorkspacePath(path) || path.endsWith('/open')) notFound();
  if (path === '/customer-care') redirect(spacePath(view, carePaths.dashboard));
  const query = await searchParams;
  const page: Page =
    parts[0] === 'tasks'
      ? parts.length === 1
        ? 'tasks'
        : parts[1] === 'new'
          ? 'new'
          : 'detail'
      : (parts[0] as Page);
  const status = query.status || 'all';
  return (
    <Workspace
      key={view + ':' + path}
      spaceSlug={view}
      page={page}
      taskId={page === 'detail' ? parts[1] : undefined}
      formId={page === 'forms' ? parts[1] : undefined}
      initialFormQuery={query.q?.slice(0, 300) || ''}
      initialStatus={
        [...statuses, 'all', 'open', 'late', 'follow'].includes(status) ? status : 'all'
      }
    />
  );
}
