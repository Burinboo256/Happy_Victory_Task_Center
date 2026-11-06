import { cookies } from 'next/headers';
import { readConfig } from './config';
import { getPool } from './db';
import { AirtableClient } from './airtable/client';
import { authenticate } from './auth/session';
import { cookieName } from './auth/security';

export function services() {
  const config = readConfig();
  const db = getPool(config);
  return { config, db, repo: new AirtableClient(config, db) };
}
export async function protectedContext() {
  const context = services();
  const token = (await cookies()).get(cookieName(context.config, 'session'))?.value;
  return {
    ...context,
    ...(await authenticate(context.db, context.repo, context.config, token)),
    token: token || '',
  };
}
