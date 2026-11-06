import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import type { QueryResult, QueryResultRow } from 'pg';
import { readConfig } from '../src/server/config';
import type { Sql } from '../src/server/db';
import type { AirtableRepository, RecordData, Table } from '../src/server/airtable/client';
import { userDto } from '../src/server/airtable/dto';

export const rid = (n: number) => 'rec' + String(n).padStart(14, '0');
export const environment = {
  APP_ENV: 'development',
  APP_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/hvr_test',
  AIRTABLE_TOKEN: 'test-only-token-never-live',
  AIRTABLE_BASE_ID: 'app00000000000000',
  AIRTABLE_USERS_TABLE: 'tbl00000000000001',
  AIRTABLE_TASKS_TABLE: 'tbl00000000000002',
  AIRTABLE_UPDATES_TABLE: 'tbl00000000000003',
  AIRTABLE_FOLLOWUPS_TABLE: 'tbl00000000000004',
  AIRTABLE_NOTIFICATIONS_TABLE: 'tbl00000000000005',
  GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-secret-never-live',
  AUTH_SECRET: 'test-only-random-secret-not-used-in-production',
  TASK_WRITES_ENABLED: 'true',
};
export const config = readConfig(environment);
export async function migrationSql() {
  const directory = new URL('../db/migrations/', import.meta.url);
  return Promise.all(
    (await readdir(directory))
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((file) => readFile(new URL(file, directory), 'utf8')),
  );
}
export async function database() {
  const engine = new PGlite();
  for (const sql of await migrationSql()) await engine.exec(sql);
  const db: Sql = {
    async query<R extends QueryResultRow>(sql: string, values: unknown[] = []) {
      const result = await engine.query<R>(sql, values);
      return {
        rows: result.rows,
        rowCount: result.affectedRows ?? result.rows.length,
      } as QueryResult<R>;
    },
  };
  await db.query('INSERT INTO hvr_instances(environment,base_id) VALUES ($1,$2)', [
    config.APP_ENV,
    config.AIRTABLE_BASE_ID,
  ]);
  await db.query('INSERT INTO hvr_runtime(environment,task_writes) VALUES ($1,true)', [
    config.APP_ENV,
  ]);
  return { db, engine };
}
const clone = <T>(value: T): T => structuredClone(value);
export function repository() {
  const tables: Record<Table, RecordData[]> = {
    users: [
      {
        id: rid(1),
        fields: {
          'Full Name': 'เลขาฯ ทดสอบ',
          Email: 'secretary@example.test',
          Role: 'Secretary',
          Active: true,
          'Google Subject': 'secretary',
        },
      },
      {
        id: rid(2),
        fields: {
          'Full Name': 'Agent A',
          Email: 'agent-a@gmail.com',
          Role: 'Agent',
          Active: true,
          'Google Subject': 'agent-a',
        },
      },
      {
        id: rid(3),
        fields: {
          'Full Name': 'Agent B',
          Email: 'agent-b@gmail.com',
          Role: 'Agent',
          Active: true,
          'Google Subject': 'agent-b',
        },
      },
    ],
    tasks: [
      {
        id: rid(11),
        fields: {
          'Task ID': 'HVR-00001',
          'Task Title': 'เอกสารทดสอบ A',
          Description: 'ข้อมูลสมมติ',
          Agent: [rid(2)],
          Category: 'งานทั่วไป',
          Status: 'New',
          Priority: 'Normal',
          'Due Date': '2026-11-06',
          'Created At': '2026-11-06T01:00:00Z',
          'Last Update': 'v1',
        },
      },
      {
        id: rid(12),
        fields: {
          'Task ID': 'HVR-00002',
          'Task Title': 'เอกสารทดสอบ B',
          Agent: [rid(3)],
          Status: 'New',
          Priority: 'High',
          'Last Update': 'v1',
        },
      },
    ],
    updates: [],
    followups: [],
    notifications: [],
  };
  const calls: string[] = [];
  const repo: AirtableRepository = {
    // Deliberately broad task/update results; tests must prove local authorization.
    async list(table, formula, fields) {
      calls.push('list:' + table);
      let result = tables[table];
      if (formula?.startsWith('{Request Key}='))
        result = result.filter(
          (r) => JSON.stringify(r.fields['Request Key']) === formula.slice(14),
        );
      return clone(
        fields
          ? result.map((r) => ({
              id: r.id,
              fields: Object.fromEntries(
                Object.entries(r.fields).filter(([name]) => fields.includes(name)),
              ),
            }))
          : result,
      );
    },
    async get(table, id) {
      calls.push('get:' + table);
      const record = tables[table].find((r) => r.id === id);
      if (!record) throw new Error('Missing fixture');
      return clone(record);
    },
    async patch(table, id, fields) {
      calls.push('patch:' + table);
      const record = tables[table].find((r) => r.id === id);
      if (!record) throw new Error('Missing fixture');
      Object.assign(record.fields, clone(fields));
      if (table === 'tasks') record.fields['Last Update'] = 'v' + calls.length;
      return clone(record);
    },
    async upsert(table, key, fields) {
      calls.push('upsert:' + table);
      let record = tables[table].find((r) => r.fields[key] === fields[key]);
      if (!record) {
        record = { id: rid(1000 + tables[table].length), fields: {} };
        tables[table].push(record);
      }
      Object.assign(record.fields, clone(fields));
      return clone(record);
    },
  };
  return {
    repo,
    tables,
    calls,
    secretary: userDto(tables.users[0]),
    agent: userDto(tables.users[1]),
    other: userDto(tables.users[2]),
  };
}
