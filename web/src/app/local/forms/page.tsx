import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { FormsPreview } from '@/components/forms-preview/forms-preview';

export const metadata = { title: 'ทดลองคลังแบบฟอร์มบนเครื่อง' };
export const dynamic = 'force-dynamic';

export default async function LocalFormsPage() {
  const host = (await headers()).get('host') || '';
  if (
    process.env.NODE_ENV !== 'development' ||
    process.env.APP_ENV !== 'development' ||
    process.env.RINLYN_FORMS_PREVIEW !== 'true' ||
    process.env.VERCEL ||
    !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
  ) {
    notFound();
  }
  return <FormsPreview />;
}
