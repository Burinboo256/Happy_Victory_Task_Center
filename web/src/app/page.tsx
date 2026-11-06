import { redirect } from 'next/navigation';
import { Workspace } from '@/components/workspace';
export default async function Home({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if ((await searchParams).view === 'create') redirect('/tasks/new');
  return <Workspace page="dashboard" />;
}
