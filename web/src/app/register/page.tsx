import type { Metadata } from 'next';
import { Brand } from '@/components/brand';
import { RegistrationForm } from '@/components/registration-form';
import { configured } from '@/server/config';
export const metadata: Metadata = { title: 'ลงทะเบียนตัวแทน' };
export const dynamic = 'force-dynamic';
export default async function Register({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const params = await searchParams;
  const status = ['pending', 'existing', 'review'].includes(params.status || '')
    ? params.status
    : '';
  return (
    <main className="registration-page">
      <section className="registration-card">
        <Brand />
        <h1>
          {status === 'pending'
            ? 'ส่งคำขอแล้ว รอผู้ดูแลอนุมัติ'
            : status === 'existing'
              ? 'บัญชีนี้พร้อมใช้งานแล้ว'
              : status === 'review'
                ? 'กรุณาติดต่อผู้ดูแล'
                : 'ลงทะเบียนตัวแทน'}
        </h1>
        {status ? (
          <div role="status">
            <p>
              {status === 'pending'
                ? 'ผู้ดูแลจะตรวจข้อมูลและเปิดใช้งานให้เป็นรายคน ระหว่างรออนุมัติยังเข้าถึงงานไม่ได้ เมื่อได้รับอนุมัติแล้ว ให้เข้าสู่ระบบด้วยบัญชี Google เดิม'
                : status === 'existing'
                  ? 'ไม่สร้างบัญชีซ้ำและไม่เปลี่ยนข้อมูลเดิม กรุณาเข้าสู่ระบบด้วยบัญชี Google ของคุณ'
                  : 'คำขอนี้ต้องตรวจสอบเพิ่มเติมก่อนยืนยันการลงทะเบียน กรุณาแจ้งอีเมล Google ให้ผู้ดูแลตรวจสอบ'}
            </p>
          </div>
        ) : (
          <>
            <p>สำหรับตัวแทนที่ต้องการใช้งาน Happy Victory</p>
            {params.error && (
              <div className="form-error" role="alert">
                ยืนยันบัญชีหรือลงทะเบียนไม่สำเร็จ กรุณาลองใหม่หรือติดต่อผู้ดูแล
              </div>
            )}
            {configured() ? (
              <RegistrationForm />
            ) : (
              <p role="status">ระบบอยู่ระหว่างเตรียมเปิดลงทะเบียน กรุณาติดต่อผู้ดูแล</p>
            )}
          </>
        )}
        <p className="registration-login">
          <a href="/login">กลับไปเข้าสู่ระบบ</a>
        </p>
      </section>
    </main>
  );
}
