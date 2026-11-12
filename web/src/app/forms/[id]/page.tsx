import { Workspace } from '@/components/workspace';
import { notFound } from 'next/navigation';
import { z } from 'zod';
export default async function Form({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  if (!z.uuid().safeParse(id).success) notFound();
  return <Workspace page="forms" formId={id} />;
}
