import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../config';
import { AppError } from '../errors';

export const baseCredentials = z
  .object({
    AIRTABLE_BASE_ID: z.string().regex(/^app[a-zA-Z0-9]{14}$/),
    AIRTABLE_TOKEN: z.string().min(12).max(1000),
    AIRTABLE_USERS_TABLE: z.string().regex(/^tbl[a-zA-Z0-9]{14}$/),
    AIRTABLE_TASKS_TABLE: z.string().regex(/^tbl[a-zA-Z0-9]{14}$/),
    AIRTABLE_UPDATES_TABLE: z.string().regex(/^tbl[a-zA-Z0-9]{14}$/),
    AIRTABLE_FOLLOWUPS_TABLE: z.string().regex(/^tbl[a-zA-Z0-9]{14}$/),
    AIRTABLE_NOTIFICATIONS_TABLE: z.string().regex(/^tbl[a-zA-Z0-9]{14}$/),
  })
  .strict();
export type BaseCredentials = z.infer<typeof baseCredentials>;
function key(c: Config) {
  if (!/^[a-f0-9]{64}$/i.test(c.WORKSPACE_ENCRYPTION_KEY || ''))
    throw new AppError(503, 'WORKSPACE_KEY', 'ยังไม่ได้ตั้งค่ากุญแจสำหรับ Space');
  return Buffer.from(c.WORKSPACE_ENCRYPTION_KEY || '', 'hex');
}
export function encryptCredentials(c: Config, id: string, value: BaseCredentials) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(c), iv);
  cipher.setAAD(Buffer.from(`${c.APP_ENV}:${id}`));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(baseCredentials.parse(value))),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted].map((b) => b.toString('base64url')).join('.');
}
export function decryptCredentials(c: Config, id: string, value: string): BaseCredentials {
  try {
    const [iv, tag, encrypted] = value.split('.').map((s) => Buffer.from(s, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', key(c), iv);
    decipher.setAAD(Buffer.from(`${c.APP_ENV}:${id}`));
    decipher.setAuthTag(tag);
    return baseCredentials.parse(
      JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')),
    );
  } catch {
    throw new AppError(
      503,
      'WORKSPACE_CREDENTIALS',
      'อ่านการเชื่อมต่อ Space ไม่สำเร็จ กรุณาติดต่อเจ้าของระบบ',
    );
  }
}
