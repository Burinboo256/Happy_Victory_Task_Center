import { NextResponse } from 'next/server';

// Stop requests before authentication, Airtable, Neon, or LINE can be invoked.
// Keep this deployment-scoped switch separate from the task-write runtime flag.
export function proxy(request: Request) {
  if (process.env.MAINTENANCE_MODE !== 'true') return NextResponse.next();
  const path = new URL(request.url).pathname;
  if (
    ['GET', 'HEAD'].includes(request.method) &&
    (path === '/api/health' || path.startsWith('/_next/static/') || path === '/favicon.ico')
  ) {
    return NextResponse.next();
  }
  const headers = {
    'Cache-Control': 'private, no-store, max-age=0',
    'Retry-After': '300',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  };
  if (path.startsWith('/api/') || request.method !== 'GET') {
    return NextResponse.json(
      { error: { code: 'MAINTENANCE', message: 'ระบบกำลังปรับปรุง กรุณาลองใหม่ภายหลัง' } },
      { status: 503, headers },
    );
  }
  return new Response(
    '<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RINLYN Secretary — กำลังปรับปรุง</title><body style="font-family:system-ui,sans-serif;max-width:36rem;margin:15vh auto;padding:24px;line-height:1.8;color:#173b38"><h1>ระบบกำลังปรับปรุง</h1><p>RINLYN Secretary จะกลับมาให้ใช้งานอีกครั้งเร็ว ๆ นี้</p><p>กรุณาลองใหม่ภายหลัง และเข้าสู่ระบบใหม่เมื่อเปิดใช้งานแล้ว</p></body></html>',
    { status: 503, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } },
  );
}
