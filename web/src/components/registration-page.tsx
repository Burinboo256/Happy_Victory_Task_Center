import { redirect } from 'next/navigation';
import { Brand } from '@/components/brand';
import { RegistrationForm } from '@/components/registration-form';
import { configured, readConfig } from '@/server/config';
import { services } from '@/server/context';
import { registrationSpace } from '@/server/workspaces/registration';
import { registrationPath, spacePath } from '@/domain/space-link';
export async function RegistrationPage({
  query: params,
  spaceSlug,
}: {
  query: { status?: string; error?: string; space?: string };
  spaceSlug?: string;
}) {
  let ready = configured(),
    workspaceName = '',
    workspaceId = params.space,
    slug = '';
  if (ready && readConfig().WORKSPACES_ENABLED) {
    try {
      const context = await services();
      if (!context.control) throw new Error('Space unavailable');
      const space = await registrationSpace(
        context.db,
        context.config,
        context.control,
        workspaceId,
        spaceSlug,
      );
      workspaceName = space.config.workspace?.name || '';
      workspaceId = space.row.id;
      slug = space.row.slug;
    } catch {
      ready = false;
    }
  } else if (spaceSlug) ready = false;
  if (ready && slug && !spaceSlug) {
    const query = new URLSearchParams();
    if (params.status && ['pending', 'existing', 'review'].includes(params.status))
      query.set('status', params.status);
    if (params.error) query.set('error', 'google');
    redirect(registrationPath(slug) + (query.size ? '?' + query : ''));
  }
  const status =
    ready && ['pending', 'existing', 'review'].includes(params.status || '') ? params.status : '';
  return (
    <main className="registration-page">
      <section className="registration-card">
        <Brand />
        {workspaceName && (
          <p>
            ลงทะเบียนเข้า Space: <strong>{workspaceName}</strong>
          </p>
        )}
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
            <p>สำหรับตัวแทนที่ต้องการใช้งาน RINLYN Secretary</p>
            {params.error && (
              <div className="form-error" role="alert">
                ยืนยันบัญชีหรือลงทะเบียนไม่สำเร็จ กรุณาลองใหม่หรือติดต่อผู้ดูแล
              </div>
            )}
            {ready ? (
              <RegistrationForm workspaceId={workspaceId} />
            ) : (
              <p role="status">
                {spaceSlug
                  ? 'ไม่พบ Space หรือ Space นี้ยังไม่เปิดรับลงทะเบียน กรุณาติดต่อผู้ดูแล'
                  : 'ระบบอยู่ระหว่างเตรียมเปิดลงทะเบียน กรุณาติดต่อผู้ดูแล'}
              </p>
            )}
          </>
        )}
        <p className="registration-login">
          <a
            href={
              slug ? '/login?' + new URLSearchParams({ returnTo: spacePath(slug, '/') }) : '/login'
            }
          >
            กลับไปเข้าสู่ระบบ
          </a>
        </p>
      </section>
    </main>
  );
}
