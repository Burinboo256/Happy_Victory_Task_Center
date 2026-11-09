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
  accounts: { user_id: string; display_name: string; binding: string; enabled: boolean }[];
  deliveries: {
    id: string;
    task_id: string;
    user_id: string;
    state: string;
    attempts: number;
    error_code: string | null;
    created_at: string;
  }[];
};
const stateNames: Record<string, string> = {
  pending: 'รอส่ง / รอลองใหม่',
  sending: 'กำลังส่ง',
  accepted: 'LINE รับคำขอแล้ว',
  failed: 'ส่งไม่สำเร็จ — ตรวจการตั้งค่า/โควตา',
  review: 'ต้องตรวจสอบ — หยุดส่งซ้ำเพื่อกันข้อความซ้ำ',
  cancelled: 'ยกเลิก — ผู้รับไม่ได้เปิดใช้งาน',
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
    <section className="line-settings" aria-label="แจ้งงานใหม่ผ่าน LINE">
      <h2>แจ้งงานใหม่ผ่าน LINE</h2>
      <p>รับข้อความจาก Official Account เมื่องานใหม่บันทึกสำเร็จ พร้อมปุ่มเปิดงานในเว็บ</p>
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
              {state.enabled && state.sendingAllowed ? 'เปิดแจ้งเตือนงานใหม่' : 'ยังไม่เปิดส่งแจ้งเตือน'}
            </strong>
            {state.oaId && ' · ' + state.oaId}
          </p>
          {!state.configured && (
            <p className="muted">กำลังเตรียมการเชื่อมต่อ OA เมื่อพร้อมแล้ว เลขาจะเชื่อมบัญชีได้ที่หน้านี้</p>
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
                  {account.enabled ? 'ผู้ดูแลเปิดรับแจ้งเตือนแล้ว' : 'รอผู้ดูแลเปิดรับแจ้งเตือน'}
                </p>
              ))}
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
                {!state.accounts.length && (
                  <p>ยังไม่มีเลขาเชื่อมบัญชี ให้เลขาเข้าสู่ระบบ → ทีมของเรา → เชื่อม LINE ก่อน</p>
                )}
                {state.accounts.map((account) => (
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
                    {state.enabled ? 'ปิดแจ้งเตือนงานใหม่' : 'เปิดแจ้งเตือนงานใหม่'}
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
                เริ่มแจ้งเฉพาะงานใหม่หลังเปิดระบบ ไม่ส่งงานเก่าย้อนหลัง
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
                    {name(delivery.user_id)} · {stateNames[delivery.state] || delivery.state}
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
