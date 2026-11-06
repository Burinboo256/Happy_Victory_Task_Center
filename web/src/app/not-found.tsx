import Link from 'next/link';
import { Brand } from '@/components/brand';
export default function NotFound() {
  return (
    <main className="loading-page">
      <Brand />
      <h1>ไม่พบหน้าที่ต้องการ</h1>
      <p>ลิงก์นี้อาจไม่ถูกต้องหรือไม่มีอยู่ในระบบ</p>
      <Link className="btn" href="/">
        กลับหน้าหลัก
      </Link>
    </main>
  );
}
