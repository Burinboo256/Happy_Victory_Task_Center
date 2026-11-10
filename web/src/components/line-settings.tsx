'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { Bootstrap } from '@/domain/model';

type LineState = {
  configured: boolean;
  sendingAllowed: boolean;
  enabled: boolean;
  oaId: string;
  candidate: { id: string; name: string } | null;
  accounts: {
    user_id: string;
    display_name: string;
    binding: string;
    enabled: boolean;
    recipient_role: 'Secretary' | 'Agent';
  }[];
  deliveries: {
    id: string;
    task_id: string;
    user_id: string;
    state: string;
    attempts: number;
    error_code: string | null;
    created_at: string;
    event_type: 'new_task' | 'task_completed';
  }[];
};
const stateNames: Record<string, string> = {
  pending: 'รอส่ง / รอลองใหม่',
  sending: 'กำลังส่ง',
  accepted: 'LINE รับคำขอแล้ว',
  failed: 'ส่งไม่สำเร็จ — ตรวจการตั้งค่า/โควตา',
  review: 'ต้องตรวจสอบ — หยุดส่งซ้ำเพื่อกันข้อความซ้ำ',
  cancelled: 'ยกเลิก — ผู้รับหรือข้อมูลงานเปลี่ยนแล้ว',
};
export function LineSettings({
  data,
  request,
}: {
  data: Bootstrap;
  request: (url: string, options?: RequestInit) => Promise<unknown>;
}) {
  const [state, setState] = useState<LineState | null>(null);
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [code, setCode] = useState(''),
    [busy, setBusy] = useState(false);
  const admin = data.user.role === 'Admin';
  const agent = data.user.role === 'Agent';
  const heading = agent ? 'แจ้งงานเสร็จผ่าน LINE' : admin ? 'แจ้งเตือนงานผ่าน LINE' : 'แจ้งงานใหม่ผ่าน LINE';
  const load = useCallback(async () => {
    try {
      setState((await request('/api/line')) as LineState);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดการแจ้งเตือนไม่สำเร็จ');
    }
  }, [request]);
  useEffect(() => {
    void load();
  }, [load]);
  async function act(payload: Record<string, unknown>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = (await request('/api/line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': data.csrfToken },
        body: JSON.stringify(payload),
      })) as { code?: string };
      setCode(result.code || '');
      setMessage(
        payload.action === 'drain' ? 'เริ่มตรวจคิวแล้ว กดอัปเดตสถานะอีกครั้งสักครู่' : 'บันทึกเรียบร้อยแล้ว',
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }
  const name = (id: string) => data.users.find((u) => u.id === id)?.name || 'สมาชิก';
  return (
    <section className="line-settings" aria-label={heading}>
      <h2>{heading}</h2>
      <p>
        {agent
          ? 'รับข้อความเมื่อเลขาเปลี่ยนงานของคุณเป็นเสร็จสิ้น พร้อมปุ่มเปิดดูงาน เปิดหรือปิดรับได้ด้วยตัวเอง'
          : admin
            ? 'แจ้งงานใหม่ให้เลขาที่เลือก และแจ้งงานเสร็จให้ Agent เจ้าของงานที่เปิดรับไว้'
            : 'รับข้อความจาก Official Account เมื่องานใหม่บันทึกสำเร็จ พร้อมปุ่มเปิดงานในเว็บ'}
      </p>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="success-message">
          {message}
        </p>
      )}
      <button
        className="btn secondary small"
        type="button"
        disabled={busy}
        onClick={() => void load()}
      >
        อัปเดตสถานะ LINE
      </button>
      {state && (
        <>
          <p>
            <strong>
              {state.enabled && state.sendingAllowed ? 'ระบบส่ง LINE เปิดอยู่' : 'ระบบส่ง LINE ยังไม่เปิด'}
            </strong>
            {state.oaId && ' · ' + state.oaId}
          </p>
          {!state.configured && (
            <p className="muted">กำลังเตรียมการเชื่อมต่อ OA เมื่อพร้อมแล้ว คุณจะเชื่อมบัญชีได้ที่หน้านี้</p>
          )}
          {!admin && (
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
              {state.accounts.map((account) => (
                <p key={account.user_id}>
                  เชื่อมกับ LINE: <strong>{account.display_name}</strong> ·{' '}
                  {agent
                    ? account.enabled
                      ? 'เปิดรับแจ้งงานเสร็จแล้ว'
                      : 'ยังไม่เปิดรับแจ้งงานเสร็จ'
                    : account.enabled
                      ? 'ผู้ดูแลเปิดรับแจ้งเตือนแล้ว'
                      : 'รอผู้ดูแลเปิดรับแจ้งเตือน'}
                </p>
              ))}
              {agent &&
                state.accounts.map((account) => (
                  <p key={'preference-' + account.user_id}>
                    <button
                      className="btn small"
                      type="button"
                      onClick={() =>
                        void act({
                          action: 'preference',
                          binding: account.binding,
                          enabled: !account.enabled,
                        })
                      }
                    >
                      {account.enabled ? 'ปิดรับแจ้งงานเสร็จ' : 'เปิดรับแจ้งงานเสร็จ'}
                    </button>
                  </p>
                ))}
              {agent && (
                <p className="muted">
                  แจ้งเฉพาะงานของคุณที่เปลี่ยนเป็นเสร็จสิ้นหลังเปิดรับ ไม่ส่งงานที่เสร็จไปแล้วก่อนหน้านี้
                </p>
              )}
              <button
                className="btn small"
                type="button"
                disabled={!state.configured}
                onClick={() => void act({ action: 'start' })}
              >
                สร้างรหัสเชื่อม LINE
              </button>
              {code && (
                <div className="line-link-code">
                  <p>ส่งข้อความนี้ในแชตส่วนตัวของ OA ภายใน 10 นาที แล้วกลับมากด “อัปเดตสถานะ LINE”</p>
                  <code>{code}</code>
                  <p>ใช้รหัสนี้เชื่อม LINE ของคุณเองเท่านั้น</p>
                </div>
              )}
              {state.candidate && (
                <div className="line-link-code">
                  <p>
                    พบบัญชี LINE: <strong>{state.candidate.name}</strong> กรุณาตรวจว่าเป็นบัญชีของคุณก่อนยืนยัน
                  </p>
                  <button
                    className="btn small"
                    type="button"
                    onClick={() =>
                      void act({ action: 'confirm', candidateId: state.candidate?.id })
                    }
                  >
                    ยืนยันบัญชี LINE ของฉัน
                  </button>
                </div>
              )}
              {state.accounts.length > 0 && (
                <button
                  className="btn secondary small"
                  type="button"
                  onClick={() => void act({ action: 'disconnect' })}
                >
                  ยกเลิกการเชื่อม LINE
                </button>
              )}
            </fieldset>
          )}
          {admin && (
            <>
              <fieldset disabled={busy || !data.writesEnabled}>
                <legend>เลือกเลขาที่รับข้อความ</legend>
                {!state.accounts.some((a) => (a.recipient_role || 'Secretary') === 'Secretary') && (
                  <p>ยังไม่มีเลขาเชื่อมบัญชี ให้เลขาเข้าสู่ระบบ → ทีมของเรา → เชื่อม LINE ก่อน</p>
                )}
                {state.accounts
                  .filter((a) => (a.recipient_role || 'Secretary') === 'Secretary')
                  .map((account) => (
                    <label className="check-label" key={account.user_id}>
                      <input
                        type="checkbox"
                        checked={account.enabled}
                        onChange={(e) =>
                          void act({
                            action: 'recipient',
                            userId: account.user_id,
                            binding: account.binding,
                            enabled: e.target.checked,
                          })
                        }
                      />
                      {name(account.user_id)} · LINE {account.display_name}
                    </label>
                  ))}
                <div className="form-actions">
                  <button
                    className="btn small"
                    type="button"
                    disabled={
                      !state.enabled &&
                      (!state.configured ||
                        !state.sendingAllowed ||
                        !state.accounts.some((a) => a.enabled))
                    }
                    onClick={() => void act({ action: 'switch', enabled: !state.enabled })}
                  >
                    {state.enabled ? 'ปิดระบบแจ้งเตือน LINE' : 'เปิดระบบแจ้งเตือน LINE'}
                  </button>
                  <button
                    className="btn secondary small"
                    type="button"
                    disabled={!state.enabled || !state.sendingAllowed}
                    onClick={() => void act({ action: 'drain' })}
                  >
                    ลองส่งคิวที่พร้อมอีกครั้ง
                  </button>
                </div>
              </fieldset>
              <p className="muted">
                Agent เชื่อมบัญชีและเปิดรับแจ้งงานเสร็จได้เองที่เมนู “แจ้งเตือน LINE”
                สวิตช์ระบบนี้ควบคุมทั้งแจ้งงานใหม่และงานเสร็จ ไม่ส่งเหตุการณ์เก่าย้อนหลัง
                คิวที่ยังไม่สำเร็จจะลองใหม่เมื่อมีการใช้งานเว็บหรือถึงรอบตรวจประจำวัน
              </p>
              <h3>สถานะล่าสุด 50 รายการ</h3>
              <p className="muted">
                “LINE รับคำขอแล้ว” ไม่ได้ยืนยันว่าผู้รับอ่านแล้ว หากบล็อก OA อาจไม่ได้รับข้อความ
              </p>
              <ul className="line-deliveries">
                {state.deliveries.map((delivery) => (
                  <li key={delivery.id}>
                    <Link href={'/tasks/' + delivery.task_id}>เปิดงาน</Link> ·{' '}
                    {name(delivery.user_id)} ·{' '}
                    {delivery.event_type === 'task_completed' ? 'งานเสร็จสิ้น' : 'งานเข้าใหม่'} ·{' '}
                    {stateNames[delivery.state] || delivery.state}
                    <small>
                      {new Intl.DateTimeFormat('th-TH', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                        timeZone: 'Asia/Bangkok',
                      }).format(new Date(delivery.created_at))}{' '}
                      · ลอง {delivery.attempts} ครั้ง
                    </small>
                  </li>
                ))}
              </ul>
              {!state.deliveries.length && <p>ยังไม่มีรายการแจ้งเตือน</p>}
            </>
          )}
        </>
      )}
    </section>
  );
}
