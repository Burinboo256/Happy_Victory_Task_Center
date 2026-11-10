import type { Metadata } from 'next';
import './globals.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Happy Victory RINLYN Secretary', template: '%s · Happy Victory' },
  description: 'พื้นที่ทำงานร่วมกันสำหรับ Agent และทีมเลขาฯ Happy Victory Rinlyn',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
