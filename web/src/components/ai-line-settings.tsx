'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Bootstrap } from '@/domain/model';
type State = {
  configured: boolean;
  oaId: string;
  account: string;
  candidate: { id: string; name: string } | null;
};
export function AiLineSettings({
  data,
  request,
}: {
  data: Bootstrap;
  request: (url: string, options?: RequestInit) => Promise<unknown>;
}) {
  const [state, setState] = useState<State | null>(null);
  const [code, setCode] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setState((await request('/api/ai/account')) as State);
      setError('');
    } catch {
      setError('ตรวจการเชื่อมต่อ AI ไม่สำเร็จ กรุณาลองใหม่');
    }
  }, [request]);
  useEffect(() => {
    void load();
  }, [load]);
  async function act(action: string, candidateId?: string) {
    setBusy(true);
    setError('');
    try {
      const result = (await request('/api/ai/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': data.csrfToken },
        body: JSON.stringify({ action, candidateId }),
      })) as { code?: string };
      setCode(result.code || '');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เชื่อมต่อไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="line-settings" aria-label="ถาม AI ผ่าน LINE">
      <h2>ถาม AI ผ่าน LINE</h2>
      <p>ถามสถานะ สรุปวันนี้ หรือพิมพ์ “ส่งงาน” เพื่อจัดร่างและกดยืนยันสร้างงาน โดยใช้สิทธิ์เดียวกับบัญชีเว็บของคุณ</p>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <button
        className="btn secondary small"
        type="button"
        disabled={busy}
        onClick={() => void load()}
      >
        ตรวจการเชื่อมต่อ AI
      </button>
      {state && (
        <>
          {!state.configured && <p className="muted">กำลังเตรียมช่องถาม AI</p>}
          {state.account && (
            <p role="status">
              เชื่อมกับ LINE: <strong>{state.account}</strong>
            </p>
          )}
          <fieldset disabled={busy || !data.writesEnabled}>
            {state.oaId && (
              <p>
                <a
                  href={'https://line.me/R/ti/p/' + encodeURIComponent(state.oaId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  เพิ่ม OA {state.oaId} เป็นเพื่อน
                </a>
              </p>
            )}
            <p className="muted">
              เมื่อเชื่อมบัญชี คำถามและข้อมูลสถานะงานตามสิทธิ์จะผ่าน n8n และ OpenRouter เพื่อสร้างคำตอบ เมื่อส่งงาน
              ข้อความและรายละเอียดร่างที่คุณพิมพ์จะผ่าน AI ด้วย ไม่ส่งเอกสารแนบ ข้อมูลประกอบเคส
              หรือหมายเหตุภายในจากงานเดิม
            </p>
            <button
              className="btn small"
              type="button"
              disabled={!state.configured}
              onClick={() => void act('start')}
            >
              สร้างรหัสเชื่อม AI
            </button>
            {code && (
              <div className="line-link-code">
                <p>ส่งรหัสนี้ในแชตส่วนตัวของ OA ภายใน 10 นาที แล้วกลับมากด “ตรวจการเชื่อมต่อ AI”</p>
                <code>{code}</code>
                <p>ใช้เชื่อม LINE ของคุณเองเท่านั้น</p>
              </div>
            )}
            {state.candidate && (
              <div className="line-link-code">
                <p>
                  ชื่อ LINE: <strong>{state.candidate.name}</strong> ตรวจว่าเป็นบัญชีของคุณก่อนยืนยัน
                </p>
                <button
                  className="btn small"
                  type="button"
                  onClick={() => void act('confirm', state.candidate?.id)}
                >
                  ยืนยันบัญชี LINE สำหรับ AI
                </button>
              </div>
            )}
            {state.account && (
              <button
                className="btn secondary small"
                type="button"
                onClick={() => void act('disconnect')}
              >
                ยกเลิกการเชื่อม AI
              </button>
            )}
          </fieldset>
          <p>ลองถาม: “สรุปงานวันนี้” · “งานไหนเกินกำหนด” · “สถานะ HVR-00001”</p>
          <p className="muted">
            จำคำถาม–คำตอบที่ส่งสำเร็จล่าสุด 6 รอบ ภายใน 30 นาที แยกตามบัญชี เพื่อถามต่อ เช่น
            “แล้วเคสนี้กำหนดส่งวันไหน” ประวัติที่เกี่ยวข้องจะผ่าน AI อีกครั้ง โดยอ่านสถานะงานล่าสุดเสมอ พิมพ์ “ล้างความจำ”
            หรือ “เริ่มคุยใหม่” ได้ ความจำหมดอายุจะไม่ถูกใช้ และลบจากระบบเมื่อมีข้อความเข้าครั้งถัดไป
          </p>
          <p>
            ลองส่ง: “ส่งงานลูกค้าใหม่ ติดตาม Memo คุณสมชาย ด่วนมาก กำหนดส่งพรุ่งนี้” ตรวจร่างแล้วกด “ยืนยันสร้างงาน”
            จึงบันทึกจริง พิมพ์ “ดูร่าง” หรือ “ยกเลิก” ได้
          </p>
        </>
      )}
    </section>
  );
}
