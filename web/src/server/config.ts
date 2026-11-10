import { z } from 'zod';
import { AppError } from './errors';

const flag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');
const databaseFields = {
  APP_ENV: z.enum(['development', 'staging', 'production']),
  DATABASE_URL: z.string().min(1),
  AIRTABLE_BASE_ID: z.string().regex(/^app[a-zA-Z0-9]{14}$/),
};
const schema = z.object({
  ...databaseFields,
  APP_ORIGIN: z.url(),
  AIRTABLE_TOKEN: z.string().min(12),
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
  LINE_CHANNEL_ACCESS_TOKEN: z.string().min(20).optional(),
  LINE_CHANNEL_SECRET: z.string().min(16).optional(),
  LINE_OA_ID: z
    .string()
    .regex(/^@[a-zA-Z0-9._-]+$/)
    .optional(),
  LINE_BOT_USER_ID: z
    .string()
    .regex(/^U[a-f0-9]{32}$/)
    .optional(),
  CRON_SECRET: z.string().min(32).optional(),
  AI_LINE_ENABLED: flag,
  AI_LINE_CHANNEL_ACCESS_TOKEN: z.string().min(20).optional(),
  AI_LINE_CHANNEL_SECRET: z.string().min(16).optional(),
  AI_LINE_OA_ID: z
    .string()
    .regex(/^@[a-zA-Z0-9._-]+$/)
    .optional(),
  AI_LINE_BOT_USER_ID: z
    .string()
    .regex(/^U[a-f0-9]{32}$/)
    .optional(),
});
export type Config = z.infer<typeof schema>;
export const productionBase = 'appDS1Ji5cqIohPq3';
const invalid = () => new AppError(503, 'NOT_CONFIGURED', 'ระบบยังตั้งค่าบริการไม่ครบ กรุณาติดต่อผู้ดูแล');

function validateDatabase(value: string) {
  const database = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw invalid();
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) &&
    database.searchParams.get('sslmode') !== 'verify-full'
  )
    throw invalid();
}
function validateBinding(config: Pick<Config, 'APP_ENV' | 'AIRTABLE_BASE_ID'>, target?: string) {
  if (config.APP_ENV !== 'production' && config.AIRTABLE_BASE_ID === productionBase)
    throw invalid();
  if (target === 'preview' && config.APP_ENV !== 'staging') throw invalid();
  if (target === 'production' && config.APP_ENV !== 'production') throw invalid();
}

// Database setup precedes OAuth/PAT setup. This validator is used only by the migration CLI.
export function readMigrationConfig(env: Record<string, string | undefined> = process.env) {
  const parsed = z
    .object({ ...databaseFields, DATABASE_MIGRATION_URL: z.string().optional() })
    .safeParse(env);
  if (!parsed.success) throw invalid();
  try {
    validateBinding(parsed.data, env.VERCEL_ENV);
    validateDatabase(parsed.data.DATABASE_URL);
    const connection = parsed.data.DATABASE_MIGRATION_URL || parsed.data.DATABASE_URL;
    validateDatabase(connection);
    return {
      APP_ENV: parsed.data.APP_ENV,
      AIRTABLE_BASE_ID: parsed.data.AIRTABLE_BASE_ID,
      DATABASE_URL: connection,
    };
  } catch {
    throw invalid();
  }
}

export function readConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = schema.safeParse(env);
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
    validateDatabase(config.DATABASE_URL);
    validateBinding(config, env.VERCEL_ENV);
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
