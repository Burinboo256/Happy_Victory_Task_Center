import { randomInt } from 'node:crypto';
import type { Config } from '../config';
import { atomic, type Sql } from '../db';
import { type AirtableRepository, type RecordData, type Table, recordId } from '../airtable/client';
import { AppError } from '../errors';
import { compileFilter } from './filter';

export const businessTables = ['tasks', 'updates', 'followups', 'notifications'] as const;
export type BusinessTable = (typeof businessTables)[number];
export const keyField = (table: BusinessTable) =>
  table === 'tasks' ? 'Request Key' : 'Operation Key';
export const inTransaction = (db: Sql) => ({
  ...db,
  query: db.query.bind(db),
  transaction: async <T>(work: (sql: Sql) => Promise<T>) => work(db),
});
function newId() {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  return `rec${Array.from({ length: 14 }, () => alphabet[randomInt(alphabet.length)]).join('')}`;
}
export class NeonTaskRepository implements AirtableRepository {
  constructor(
    readonly db: Sql,
    readonly config: Config,
    readonly users: AirtableRepository,
  ) {}
  withDatabase(db: Sql) {
    return new NeonTaskRepository(inTransaction(db), this.config, this.users);
  }
  async list(table: Table, formula?: string, fields?: readonly string[]) {
    if (table === 'users') return this.users.list(table, formula, fields);
    const values: unknown[] = [this.config.APP_ENV, table];
    const filter = compileFilter(formula, values);
    const result = await this.db.query<RecordData>(
      `SELECT id,fields FROM hvr_task_records WHERE environment=$1 AND kind=$2 AND ${filter} ORDER BY created_at,id`,
      values,
    );
    return result.rows.map((r) =>
      fields
        ? {
            id: r.id,
            fields: Object.fromEntries(
              Object.entries(r.fields).filter(([name]) => fields.includes(name)),
            ),
          }
        : r,
    );
  }
  async get(table: Table, id: string) {
    if (table === 'users') return this.users.get(table, id);
    const result = await this.db.query<RecordData & { airtable_id: string | null }>(
      'SELECT id,fields,airtable_id FROM hvr_task_records WHERE environment=$1 AND kind=$2 AND id=$3',
      [this.config.APP_ENV, table, recordId(id)],
    );
    if (!result.rows[0]) throw new AppError(404, 'TASK_NOT_FOUND', 'ไม่พบรายการใน Space นี้');
    const row = result.rows[0];
    // Legacy attachment download URLs expire. Refresh only those URLs, never overwrite Neon task data.
    if (
      table === 'tasks' &&
      Array.isArray(row.fields.Attachments) &&
      row.fields.Attachments.length &&
      row.airtable_id
    )
      row.fields.Attachments =
        (await this.users.get('tasks', row.airtable_id)).fields.Attachments || [];
    return { id: row.id, fields: row.fields };
  }
  async patch(table: Table, id: string, fields: Record<string, unknown>) {
    if (table === 'users') return this.users.patch(table, id, fields);
    return atomic(this.db, async (db) => {
      const row = (
        await db.query(
          'SELECT * FROM hvr_task_records WHERE environment=$1 AND kind=$2 AND id=$3 FOR UPDATE',
          [this.config.APP_ENV, table, recordId(id)],
        )
      ).rows[0];
      if (!row) throw new AppError(404, 'TASK_NOT_FOUND', 'ไม่พบรายการใน Space นี้');
      return this.save(
        db,
        table,
        id,
        { ...row.fields, ...fields },
        Number(row.version) + 1,
        row.key_field,
        row.key_value,
      );
    });
  }
  async upsert(table: Table, key: string, fields: Record<string, unknown>) {
    if (table === 'users') return this.users.upsert(table, key, fields);
    if (key !== keyField(table) || typeof fields[key] !== 'string' || !fields[key])
      throw new AppError(422, 'TASK_KEY', 'รหัสคำขอไม่ถูกต้อง');
    return atomic(this.db, async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${this.config.APP_ENV}:${this.config.AIRTABLE_BASE_ID}:${table}:${fields[key]}`,
      ]);
      const row = (
        await db.query(
          'SELECT * FROM hvr_task_records WHERE environment=$1 AND kind=$2 AND key_field=$3 AND key_value=$4 FOR UPDATE',
          [this.config.APP_ENV, table, key, fields[key]],
        )
      ).rows[0];
      const id = row?.id || newId();
      // New internal IDs retain the public URL format. Only the mirror mapping may be sent to Airtable.
      const initial =
        table === 'tasks'
          ? { 'Task ID': `RN-${id.slice(3)}`, 'Created At': new Date().toISOString() }
          : table === 'updates'
            ? { 'Updated At': new Date().toISOString() }
            : {};
      return this.save(
        db,
        table,
        id,
        { ...initial, ...row?.fields, ...fields },
        Number(row?.version || 0) + 1,
        key,
        String(fields[key]),
      );
    });
  }
  private async save(
    db: Sql,
    table: BusinessTable,
    id: string,
    fields: Record<string, unknown>,
    version: number,
    key: string,
    value: string,
  ) {
    if (fields[key] !== undefined && fields[key] !== value)
      throw new AppError(409, 'TASK_KEY_IMMUTABLE', 'ไม่สามารถเปลี่ยนรหัสคำขอ');
    fields[key] = value;
    if (table === 'tasks') fields['Last Update'] = `neon:${version}`;
    await db.query(
      `INSERT INTO hvr_task_records(environment,kind,id,fields,version,key_field,key_value) VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(environment,kind,id) DO UPDATE SET fields=EXCLUDED.fields,version=EXCLUDED.version`,
      [this.config.APP_ENV, table, id, JSON.stringify(fields), version, key, value],
    );
    await db.query(
      `INSERT INTO hvr_airtable_outbox(environment,kind,record_id,version,fields) VALUES($1,$2,$3,$4,$5)`,
      [this.config.APP_ENV, table, id, version, JSON.stringify(fields)],
    );
    return { id, fields };
  }
}

export async function taskRepository(db: Sql, config: Config, repo: AirtableRepository) {
  const exists = (await db.query("SELECT to_regclass('hvr_task_storage') AS name")).rows[0]?.name;
  if (!exists) return repo;
  const state = (
    await db.query('SELECT * FROM hvr_task_storage WHERE environment=$1', [config.APP_ENV])
  ).rows[0];
  if (!state || state.mode === 'airtable') return repo;
  if (state.base_id !== config.AIRTABLE_BASE_ID || !state.imported_at)
    throw new AppError(503, 'TASK_STORAGE_BINDING', 'ข้อมูลหลักของงานยังไม่พร้อม');
  return new NeonTaskRepository(db, config, repo);
}
