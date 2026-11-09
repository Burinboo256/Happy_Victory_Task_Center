import { services } from '@/server/context';
import { route, json } from '@/server/http';
import { AppError } from '@/server/errors';
import { verifyInstance } from '@/server/runtime';
import { receiveWebhook } from '@/server/line/accounts';
import { lineConfigured, verifySignature } from '@/server/line/client';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return route(async () => {
    const c = services();
    if (!lineConfigured(c.config)) throw new AppError(503, 'LINE_SETUP', 'ยังไม่ได้ตั้งค่า OA');
    const reader = request.body?.getReader();
    if (!reader) throw new AppError(400, 'LINE_BODY', 'ไม่พบข้อมูล');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 262144) {
        await reader.cancel();
        throw new AppError(413, 'LINE_BODY_SIZE', 'ข้อมูลใหญ่เกินไป');
      }
      chunks.push(value);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    verifySignature(
      raw,
      request.headers.get('x-line-signature'),
      c.config.LINE_CHANNEL_SECRET || '',
    );
    await verifyInstance(c.db, c.config);
    await receiveWebhook(c.db, c.config, JSON.parse(raw));
    return json({ received: true });
  });
}
