import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { RegistrationPage } from '@/components/registration-page';
import { isSpaceSlug } from '@/domain/space-link';
export const metadata: Metadata = { title: 'ลงทะเบียนตัวแทน' };
export const dynamic = 'force-dynamic';
export default async function SpaceRegister({
  params,
  searchParams,
}: {
  params: Promise<{ view: string }>;
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const { view } = await params;
  if (!isSpaceSlug(view)) notFound();
  return <RegistrationPage query={await searchParams} spaceSlug={view} />;
}
