import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

export const dynamic = 'force-dynamic';

const dmSans = localFont({
  src: './fonts/dm-sans.woff2',
  variable: '--font-dm-sans',
  weight: '100 1000',
  display: 'swap',
});
const notoSansThai = localFont({
  src: './fonts/noto-sans-thai.woff2',
  variable: '--font-noto-sans-thai',
  weight: '100 900',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Happy Victory RINLYN Secretary', template: '%s · Happy Victory' },
  description: 'พื้นที่ทำงานร่วมกันสำหรับ Agent และทีมเลขาฯ Happy Victory Rinlyn',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" className={`${dmSans.variable} ${notoSansThai.variable}`}>
      <body>{children}</body>
    </html>
  );
}
