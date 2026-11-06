import { AppError } from '../errors';

export const invalidData = () =>
  new AppError(503, 'AIRTABLE_DATA', 'ข้อมูลบางรายการไม่ถูกต้อง กรุณาติดต่อผู้ดูแล');
export const text = (value: unknown) => (typeof value === 'string' ? value : '');
const blank = (value: unknown) => value === undefined || value === null || value === '';
export function day(value: unknown) {
  if (blank(value)) return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalidData();
  const time = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value)
    throw invalidData();
  return value;
}
export function timestamp(value: unknown) {
  if (blank(value)) return '';
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    throw invalidData();
  day(value.slice(0, 10));
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw invalidData();
  return value;
}
export function singleLink(value: unknown, required = false) {
  if (!required && (blank(value) || (Array.isArray(value) && value.length === 0))) return '';
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    typeof value[0] !== 'string' ||
    !/^rec[a-zA-Z0-9]{14}$/.test(value[0])
  )
    throw invalidData();
  return value[0];
}
export const createdTime = (value: unknown) =>
  typeof value === 'string' && value.length === 10 ? day(value) : timestamp(value);
export function httpsUrl(value: unknown) {
  try {
    if (typeof value !== 'string') return '';
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}
