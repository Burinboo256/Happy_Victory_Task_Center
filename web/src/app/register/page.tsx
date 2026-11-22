import type { Metadata } from 'next';
import { RegistrationPage } from '@/components/registration-page';
export const metadata: Metadata = { title: 'ลงทะเบียนตัวแทน' };
export const dynamic = 'force-dynamic';
export default async function Register({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string; space?: string }>;
}) {
  return <RegistrationPage query={await searchParams} />;
}
