import { Workspace } from '@/components/workspace';
export default async function Forms({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  return <Workspace page="forms" initialFormQuery={(await searchParams).q?.slice(0, 300) || ''} />;
}
