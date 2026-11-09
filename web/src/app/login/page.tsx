import type { Metadata } from 'next';
import { Brand } from '@/components/brand';
import { configured } from '@/server/config';
import { safeReturnTo } from '@/server/auth/security';

export const metadata: Metadata = { title: 'เข้าสู่ระบบ' };
export const dynamic = 'force-dynamic';
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string }>;
}) {
  const params = await searchParams,
    returnTo = safeReturnTo(params.returnTo),
    ready = configured();
  const creating = returnTo === '/tasks/new';
  return (
    <main className="login-page">
      <section className="login-story">
        <Brand />
        <div className="story-copy">
          <span className="eyebrow">A LITTLE MORE ORGANIZED. A LOT MORE POSSIBLE.</span>
          <h1>
            Great things,
            <br />
            one task at a time.
          </h1>
          <p>
            พื้นที่ทำงานที่ช่วยให้ทุกการประสานงาน
            <br />
            เป็นเรื่องง่าย และทุกงานเดินหน้าต่อได้
          </p>
        </div>
        <footer>HAPPY VICTORY RINLYN · AGENT &amp; SECRETARY WORKSPACE</footer>
        <span className="story-decoration" aria-hidden="true">
          ✦
        </span>
      </section>
      <section className="login-main">
        <div className="login-card">
          <span className="eyebrow">WELCOME TO YOUR WORKSPACE</span>
          <h2>{creating ? 'พร้อมส่งงานใหม่แล้วหรือยัง?' : 'ยินดีต้อนรับกลับมา'}</h2>
          <p>
            {creating ? 'เข้าสู่ระบบ แล้วเริ่มกรอกรายละเอียดงานได้เลย' : 'เข้าสู่ระบบเพื่อติดตามงานและทำงานร่วมกัน'}
          </p>
          {params.error && (
            <div className="form-error" role="alert">
              เข้าสู่ระบบไม่สำเร็จหรือบัญชียังไม่ได้รับอนุญาต กรุณาลองอีกครั้งหรือติดต่อผู้ดูแล
            </div>
          )}
          {ready ? (
            <a
              className="btn google-button"
              href={'/api/auth/google?returnTo=' + encodeURIComponent(returnTo)}
            >
              <span className="google-letter" aria-hidden="true">
                G
              </span>
              เข้าสู่ระบบด้วยบัญชี Google<span aria-hidden="true">↗</span>
            </a>
          ) : (
            <div className="setup-notice" role="status">
              <strong>กำลังเตรียมพื้นที่ทำงาน</strong>
              <p>ระบบอยู่ระหว่างเตรียมเปิดใช้งาน กรุณาติดต่อผู้ดูแลเพื่อเริ่มใช้งาน</p>
            </div>
          )}
          <div className="login-note">
            <span aria-hidden="true">◇</span>
            <p>
              สำหรับ Agent และเลขาฯ ที่ได้รับอนุญาตเท่านั้น
              <br />
              ใช้บัญชี Google ที่ผู้ดูแลอนุมัติแล้ว
            </p>
          </div>
          <p>
            <a href="/register">ยังไม่มีบัญชี? ลงทะเบียนตัวแทน</a>
          </p>
          <div className="login-bottom">
            ทุกงานสำคัญ ทุกความคืบหน้ามีค่า <span aria-hidden="true">✦</span>
          </div>
        </div>
      </section>
    </main>
  );
}
