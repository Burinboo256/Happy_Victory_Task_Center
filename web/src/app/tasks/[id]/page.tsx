import { notFound } from 'next/navigation';
import { Workspace } from '@/components/workspace';
export default async function TaskDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^rec[a-zA-Z0-9]{14}$/.test(id)) notFound();
  return <Workspace page="detail" taskId={id} />;
}
