import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

if (process.env.VERCEL) throw new Error('The forms preview runs only on a local machine');
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
// Explicit empty values override .env.local; this preview needs no connected services.
for (const line of fs.readFileSync(path.join(web, '.env.example'), 'utf8').split(/\r?\n/)) {
  const key = /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1];
  if (key) env[key] = '';
}
for (const key of Object.keys(env)) {
  if (/^(LINE_|AI_|GOOGLE_|AIRTABLE_|DATABASE_|AUTH_SECRET|CRON_SECRET)/.test(key)) env[key] = '';
}
Object.assign(env, {
  NODE_ENV: 'development',
  APP_ENV: 'development',
  APP_ORIGIN: 'http://127.0.0.1:3011',
  RINLYN_FORMS_PREVIEW: 'true',
  LINE_CHANNEL_ACCESS_TOKEN: '',
  LINE_CHANNEL_SECRET: '',
  LINE_BOT_USER_ID: '',
  LINE_OA_ID: '',
  CRON_SECRET: '',
  TASK_WRITES_ENABLED: 'false',
  JOBS_ENABLED: 'false',
  ENABLE_EMAIL_NOTIFICATIONS: 'false',
  ENABLE_LINE_NOTIFICATIONS: 'false',
  AI_LINE_ENABLED: 'false',
  NEXT_TELEMETRY_DISABLED: '1',
});
console.log('Local forms preview: http://127.0.0.1:3011/local/forms');
const child = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3011'],
  { cwd: web, env, stdio: 'inherit', windowsHide: true },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
child.on('error', () => {
  console.error('Could not start the local forms preview');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code || 0;
});
