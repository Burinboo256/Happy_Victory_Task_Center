import { Workspace } from '@/components/workspace';
import { statuses } from '@/domain/model';
export default async function Tasks({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const query = (await searchParams).status || 'all';
  const status = [...statuses, 'all', 'open', 'late', 'follow'].includes(query) ? query : 'all';
  return <Workspace key={status} page="tasks" initialStatus={status} />;
}
