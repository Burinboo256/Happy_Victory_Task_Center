import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../config';
import { AppError } from '../errors';

export const lineId = z.string().regex(/^U[a-f0-9]{32}$/);
export function lineConfigured(config: Config) {
  return !!(
    config.LINE_CHANNEL_ACCESS_TOKEN &&
    config.LINE_CHANNEL_SECRET &&
    config.LINE_OA_ID &&
    config.LINE_BOT_USER_ID
  );
}
export function verifySignature(body: string, signature: string | null, secret: string) {
  const expected = createHmac('sha256', secret).update(body).digest('base64');
  if (
    !signature ||
    Buffer.byteLength(signature) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    throw new AppError(401, 'LINE_SIGNATURE', 'ลายเซ็นไม่ถูกต้อง');
}
export async function lineProfile(config: Config, id: string, transport: typeof fetch = fetch) {
  const response = await transport('https://api.line.me/v2/bot/profile/' + lineId.parse(id), {
    headers: { Authorization: 'Bearer ' + config.LINE_CHANNEL_ACCESS_TOKEN },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok)
    throw new AppError(503, 'LINE_PROFILE', 'อ่านบัญชี LINE ไม่สำเร็จ กรุณาเพิ่ม OA เป็นเพื่อนแล้วลองใหม่');
  const profile = z
    .object({ userId: lineId, displayName: z.string().min(1).max(200) })
    .parse(await response.json());
  if (profile.userId !== id) throw new AppError(503, 'LINE_PROFILE', 'บัญชี LINE ไม่ตรงกัน');
  return profile.displayName;
}
export async function pushMessage(
  config: Config,
  to: string,
  id: string,
  message: unknown,
  transport: typeof fetch = fetch,
) {
  const response = await transport('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + config.LINE_CHANNEL_ACCESS_TOKEN,
      'X-Line-Retry-Key': id,
    },
    body: JSON.stringify({ to, messages: [message] }),
    signal: AbortSignal.timeout(8000),
  });
  // Acceptance is not proof of delivery/read (e.g. a blocked OA).
  if (
    response.ok ||
    (response.status === 409 && response.headers.get('x-line-accepted-request-id'))
  )
    return 'accepted';
  if (response.status === 429 || response.status >= 500) return 'retry';
  return 'failed';
}
