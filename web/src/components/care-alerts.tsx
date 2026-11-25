'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
export function CareAlerts({
  href,
  request,
}: {
  href: string;
  request: (url: string, options?: RequestInit) => Promise<{ total: number; late: number }>;
}) {
  const [counts, setCounts] = useState<{ total: number; late: number } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const value = await request('/api/customer-care?scope=alerts', { signal: abort.signal });
        if (!abort.signal.aborted) setCounts(value);
      } catch {
        if (!abort.signal.aborted) setCounts(null);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 300000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      abort.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [request]);
  return (
    <p>
      <Link className="btn secondary" href={href}>
        {counts ? `นัดดูแลลูกค้า ${counts.total} รายการ · เกินนัด ${counts.late}` : 'เปิดคิวดูแลลูกค้า'}
      </Link>
    </p>
  );
}
