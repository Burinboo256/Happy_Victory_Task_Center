'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Brand } from './brand';
import styles from './space-hub.module.css';

export function SpaceEntry({ slug }: { slug: string }) {
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const login = () =>
      window.location.replace('/login?returnTo=' + encodeURIComponent('/' + slug));
    async function enter() {
      const response = await fetch('/api/spaces', { cache: 'no-store', signal: controller.signal });
      if (response.status === 401) return login();
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || 'โหลด Space ไม่สำเร็จ');
      const space = body.items?.find((item: { slug: string }) => item.slug === slug);
      if (!body.enabled || !space?.active || !space.approved)
        throw new Error('ไม่พบ Space ที่เปิดใช้งานสำหรับบัญชีนี้ กรุณาตรวจลิงก์หรือติดต่อ Admin เพื่ออนุมัติสิทธิ์');
      if (controller.signal.aborted) return;
      const selected = await fetch('/api/spaces', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': body.csrfToken },
        body: JSON.stringify({ action: 'select', id: space.id }),
      });
      if (selected.status === 401) return login();
      const result = await selected.json();
      if (!selected.ok) throw new Error(result.error?.message || 'เข้า Space ไม่สำเร็จ');
      if (!controller.signal.aborted) window.location.replace('/');
    }
    void enter().catch((e) => {
      if (!controller.signal.aborted) setError(e.message);
    });
    return () => controller.abort();
  }, [slug]);
  return (
    <main className={styles.hub}>
      <Brand />
      <h1>เข้า Space</h1>
      {error ? <p role="alert">{error}</p> : <p role="status">กำลังเปิด Space {slug}…</p>}
      {error && (
        <>
          <button type="button" className="btn secondary" onClick={() => window.location.reload()}>
            ลองอีกครั้ง
          </button>
          <p>
            <Link href="/spaces">เลือก Space อื่น</Link>
          </p>
        </>
      )}
    </main>
  );
}
