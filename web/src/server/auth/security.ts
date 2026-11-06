import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Config } from '../config';
import { AppError } from '../errors';

export const randomToken = () => randomBytes(32).toString('hex');
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const safeEqual = (a: string, b: string) => {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
export const cookieName = (config: Config, kind: 'session' | 'oauth') =>
  `${config.APP_ORIGIN.startsWith('https:') ? '__Host-' : ''}hvr-${kind}`;
export const cookieOptions = (config: Config, seconds: number) => ({
  httpOnly: true,
  secure: config.APP_ORIGIN.startsWith('https:'),
  sameSite: 'lax' as const,
  path: '/',
  maxAge: seconds,
});
export function signBinding(value: string, secret: string) {
  return value + '.' + createHmac('sha256', secret).update(value).digest('hex');
}
export function readBinding(value: string | undefined, secret: string) {
  if (!value || !/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(value)) return '';
  return safeEqual(signBinding(value.slice(0, 64), secret), value) ? value.slice(0, 64) : '';
}
const paths = new Set([
  '/',
  '/tasks',
  '/tasks/new',
  '/inbox',
  '/followups',
  '/calendar',
  '/reports',
  '/team',
  '/history',
]);
export const safeReturnTo = (value: string | null | undefined) =>
  value && (paths.has(value) || /^\/tasks\/rec[a-zA-Z0-9]{14}$/.test(value)) ? value : '/';
export function requireCsrf(request: Request, csrfToken: string, config: Config) {
  const token = request.headers.get('x-csrf-token') || '';
  if (
    request.headers.get('origin') !== config.APP_ORIGIN ||
    !/^[a-f0-9]{64}$/.test(token) ||
    !safeEqual(token, csrfToken)
  ) {
    throw new AppError(403, 'CSRF', 'คำขอไม่ถูกต้อง กรุณาโหลดหน้าเว็บใหม่');
  }
}
