'use client';
import { useState, type FormEvent } from 'react';
export function RegistrationForm() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fields.get('fullName'),
          agentCode: fields.get('agentCode'),
          phone: fields.get('phone'),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || 'เริ่มลงทะเบียนไม่สำเร็จ กรุณาลองอีกครั้ง');
      window.location.assign(result.url);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'เชื่อมต่อไม่สำเร็จ กรุณาลองอีกครั้ง');
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="registration-form">
      <label htmlFor="registration-name">ชื่อ–นามสกุล</label>
      <input
        id="registration-name"
        name="fullName"
        autoComplete="name"
        required
        minLength={2}
        maxLength={120}
        disabled={busy}
      />
      <label htmlFor="registration-code">รหัสตัวแทน</label>
      <input
        id="registration-code"
        name="agentCode"
        required
        maxLength={40}
        pattern="[A-Za-z0-9\-]+"
        aria-describedby="code-hint"
        disabled={busy}
      />
      <small id="code-hint">ใช้ตัวอักษรภาษาอังกฤษ ตัวเลข หรือขีดกลาง</small>
      <label htmlFor="registration-phone">เบอร์โทรศัพท์</label>
      <input
        id="registration-phone"
        name="phone"
        type="tel"
        autoComplete="tel"
        required
        pattern="\+?[0-9]{9,15}"
        maxLength={16}
        aria-describedby="phone-hint"
        placeholder="0812345678"
        disabled={busy}
      />
      <small id="phone-hint">กรอกตัวเลขติดกัน เช่น 0812345678 หรือ +66812345678</small>
      <p>ขั้นต่อไปเลือกบัญชี Google เพื่อยืนยันอีเมล เราจะส่งข้อมูลนี้ให้ผู้ดูแลตรวจและอนุมัติ ก่อนเริ่มใช้งาน</p>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <button className="btn primary google-button" disabled={busy} type="submit">
        {busy ? 'กำลังไป Google…' : 'ยืนยัน Google และส่งคำขอสมัคร'}
      </button>
    </form>
  );
}
