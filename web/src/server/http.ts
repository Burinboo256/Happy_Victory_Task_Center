import { NextResponse } from 'next/server';
import { AppError } from './errors';
import { ZodError } from 'zod';

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
export function failure(error: unknown) {
  const app =
    error instanceof AppError
      ? error
      : error instanceof ZodError
        ? new AppError(422, 'VALIDATION', 'กรุณาตรวจสอบข้อมูลที่กรอก')
        : new AppError(503, 'UNAVAILABLE', 'ระบบไม่พร้อมใช้งานชั่วคราว กรุณาลองอีกครั้ง');
  if (!(error instanceof AppError) && !(error instanceof ZodError))
    console.error('request_failed', { code: app.code });
  const response = json({ error: { code: app.code, message: app.message } }, app.status);
  if (app.retryAfter) response.headers.set('Retry-After', String(app.retryAfter));
  return response;
}
export async function route(work: () => Promise<Response>) {
  try {
    return await work();
  } catch (error) {
    return failure(error);
  }
}
export async function readBody(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new AppError(415, 'CONTENT_TYPE', 'กรุณาส่งข้อมูลแบบ JSON');
  if (Number(request.headers.get('content-length') || 0) > 32768)
    throw new AppError(413, 'BODY_SIZE', 'ข้อมูลมีขนาดใหญ่เกินไป');
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(422, 'VALIDATION', 'ไม่พบข้อมูล');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 32768) {
      await reader.cancel();
      throw new AppError(413, 'BODY_SIZE', 'ข้อมูลมีขนาดใหญ่เกินไป');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError(422, 'VALIDATION', 'ข้อมูล JSON ไม่ถูกต้อง');
  }
}
