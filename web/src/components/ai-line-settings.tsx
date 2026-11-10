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
      <p>ถามสถานะงาน งานเร่งด่วน และสรุปวันนี้ผ่าน OA สำหรับ AI โดยใช้สิทธิ์เดียวกับบัญชีเว็บของคุณ</p>
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
              เมื่อเชื่อมบัญชี คำถามและข้อมูลสถานะงานตามสิทธิ์จะผ่าน n8n และ OpenRouter เพื่อสร้างคำตอบ
              ไม่ส่งเอกสารแนบ รายละเอียดส่วนตัวในช่องเคส หรือหมายเหตุภายใน
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
        </>
      )}
    </section>
  );
}
