import { z } from 'zod';
import { AppError } from './errors';

const flag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');
const schema = z.object({
  APP_ENV: z.enum(['development', 'staging', 'production']),
  APP_ORIGIN: z.url(),
  DATABASE_URL: z.string().min(1),
  AIRTABLE_TOKEN: z.string().min(12),
  AIRTABLE_BASE_ID: z.string().regex(/^app[a-zA-Z0-9]{14}$/),
  AIRTABLE_USERS_TABLE: z.string().regex(/^tbl[a-zA-Z0-9]{14}$/),
  AIRTABLE_TASKS_TABLE: z.string().regex(/^tbl[a-zA-Z0-9]{14}$/),
  AIRTABLE_UPDATES_TABLE: z.string().regex(/^tbl[a-zA-Z0-9]{14}$/),
  AIRTABLE_FOLLOWUPS_TABLE: z.string().regex(/^tbl[a-zA-Z0-9]{14}$/),
  AIRTABLE_NOTIFICATIONS_TABLE: z.string().regex(/^tbl[a-zA-Z0-9]{14}$/),
  GOOGLE_CLIENT_ID: z.string().endsWith('.apps.googleusercontent.com'),
  GOOGLE_CLIENT_SECRET: z.string().min(8),
  AUTH_SECRET: z.string().min(32),
  TASK_WRITES_ENABLED: flag,
  JOBS_ENABLED: flag,
  ENABLE_EMAIL_NOTIFICATIONS: flag,
  ENABLE_LINE_NOTIFICATIONS: flag,
});
export type Config = z.infer<typeof schema>;
export const productionBase = 'appDS1Ji5cqIohPq3';

export function readConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = schema.safeParse(env);
  const invalid = () => new AppError(503, 'NOT_CONFIGURED', 'ระบบยังตั้งค่าบริการไม่ครบ กรุณาติดต่อผู้ดูแล');
  if (!result.success) throw invalid();
  const config = result.data;
  try {
    const origin = new URL(config.APP_ORIGIN);
    if (origin.origin !== config.APP_ORIGIN || origin.username || origin.password) throw invalid();
    const local = ['localhost', '127.0.0.1'].includes(origin.hostname);
    if (
      origin.protocol !== 'https:' &&
      !(config.APP_ENV === 'development' && local && origin.protocol === 'http:')
    )
      throw invalid();
    const database = new URL(config.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw invalid();
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) &&
      database.searchParams.get('sslmode') !== 'verify-full'
    )
      throw invalid();
    if (config.APP_ENV !== 'production' && config.AIRTABLE_BASE_ID === productionBase)
      throw invalid();
    if (env.VERCEL_ENV === 'preview' && config.APP_ENV !== 'staging') throw invalid();
    if (env.VERCEL_ENV === 'production' && config.APP_ENV !== 'production') throw invalid();
    if (
      config.APP_ENV !== 'production' &&
      (config.JOBS_ENABLED || config.ENABLE_EMAIL_NOTIFICATIONS || config.ENABLE_LINE_NOTIFICATIONS)
    )
      throw invalid();
  } catch {
    throw invalid();
  }
  return config;
}

export function configured() {
  try {
    readConfig();
    return true;
  } catch {
    return false;
  }
}
