import type { Config } from '../config';
import type { Sql } from '../db';
import { AppError, UncertainWrite } from '../errors';
import { z } from 'zod';

export type Table = 'users' | 'tasks' | 'updates' | 'followups' | 'notifications';
export interface RecordData {
  id: string;
  fields: Record<string, unknown>;
}
export interface AirtableRepository {
  list(table: Table, formula?: string, fields?: readonly string[]): Promise<RecordData[]>;
  get(table: Table, id: string): Promise<RecordData>;
  patch(table: Table, id: string, fields: Record<string, unknown>): Promise<RecordData>;
  upsert(table: Table, key: string, fields: Record<string, unknown>): Promise<RecordData>;
}
export const recordId = (id: string) => {
  if (!/^rec[a-zA-Z0-9]{14}$/.test(id))
    throw new AppError(422, 'INVALID_RECORD', 'รหัสรายการไม่ถูกต้อง');
  return id;
};
export const formulaValue = (value: string) =>
  '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
const record = z.object({
  id: z.string().regex(/^rec[a-zA-Z0-9]{14}$/),
  fields: z.record(z.string(), z.unknown()),
});

export class AirtableClient implements AirtableRepository {
  constructor(
    private config: Config,
    private db: Sql,
    private transport: typeof fetch = fetch,
  ) {}
  private async slot() {
    const result = await this.db.query(
      `INSERT INTO hvr_rate_limits(base_id,next_at)
      VALUES ($1, clock_timestamp() + interval '230 milliseconds')
      ON CONFLICT(base_id) DO UPDATE SET next_at=GREATEST(hvr_rate_limits.next_at,hvr_rate_limits.blocked_until,clock_timestamp())+interval '230 milliseconds'
      WHERE GREATEST(hvr_rate_limits.next_at,hvr_rate_limits.blocked_until)-clock_timestamp() <= interval '1500 milliseconds'
      RETURNING EXTRACT(EPOCH FROM (next_at-clock_timestamp()))*1000 AS wait_ms`,
      [this.config.AIRTABLE_BASE_ID],
    );
    if (!result.rows.length) {
      // A rejected request must not push the shared queue further into the future.
      const busy = await this.db.query(
        `SELECT CEIL(EXTRACT(EPOCH FROM (GREATEST(next_at,blocked_until)-clock_timestamp()))) AS retry_after
         FROM hvr_rate_limits WHERE base_id=$1`,
        [this.config.AIRTABLE_BASE_ID],
      );
      throw new AppError(
        503,
        'AIRTABLE_BUSY',
        'ระบบกำลังรอการเชื่อมต่อ กรุณาลองคำขอเดิมอีกครั้ง',
        Math.max(1, Number(busy.rows[0]?.retry_after) || 1),
      );
    }
    const wait = Math.max(0, Number(result.rows[0].wait_ms) - 230);
    if (wait) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      // Another instance may have received 429 while this request waited for its slot.
      const blocked = await this.db.query(
        `SELECT CEIL(EXTRACT(EPOCH FROM (blocked_until-clock_timestamp()))) AS retry_after
         FROM hvr_rate_limits WHERE base_id=$1`,
        [this.config.AIRTABLE_BASE_ID],
      );
      const retryAfter = Number(blocked.rows[0]?.retry_after) || 0;
      if (retryAfter > 0)
        throw new AppError(
          503,
          'AIRTABLE_BUSY',
          'กำลังรอการเชื่อมต่อข้อมูล กรุณาลองคำขอเดิมอีกครั้ง',
          retryAfter,
        );
    }
  }
  private async request(
    method: string,
    table: Table,
    id = '',
    body?: unknown,
    query?: URLSearchParams,
  ) {
    const tables = {
      users: this.config.AIRTABLE_USERS_TABLE,
      tasks: this.config.AIRTABLE_TASKS_TABLE,
      updates: this.config.AIRTABLE_UPDATES_TABLE,
      followups: this.config.AIRTABLE_FOLLOWUPS_TABLE,
      notifications: this.config.AIRTABLE_NOTIFICATIONS_TABLE,
    };
    const url = new URL(
      `https://api.airtable.com/v0/${this.config.AIRTABLE_BASE_ID}/${tables[table]}${id ? '/' + recordId(id) : ''}`,
    );
    if (query) url.search = query.toString();
    return this.call(method, url, body);
  }
  private async call(method: string, url: URL, body?: unknown, token = this.config.AIRTABLE_TOKEN) {
    await this.slot();
    let response: Response;
    try {
      response = await this.transport(url, {
        method,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      if (method !== 'GET') throw new UncertainWrite();
      throw new AppError(503, 'AIRTABLE_UNAVAILABLE', 'เชื่อมต่อข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง');
    }
    if (response.status === 429) {
      await this.db.query(
        `UPDATE hvr_rate_limits SET blocked_until=GREATEST(blocked_until,clock_timestamp()+interval '30 seconds') WHERE base_id=$1`,
        [this.config.AIRTABLE_BASE_ID],
      );
      throw new AppError(503, 'AIRTABLE_BUSY', 'กำลังรอการเชื่อมต่อข้อมูล กรุณาลองคำขอเดิมอีกครั้ง', 30);
    }
    if (!response.ok) {
      if (method !== 'GET' && response.status >= 500) throw new UncertainWrite();
      throw new AppError(
        response.status === 404 ? 404 : 503,
        'AIRTABLE_ERROR',
        response.status === 404 ? 'ไม่พบรายการนี้' : 'บริการข้อมูลไม่พร้อมใช้งาน',
      );
    }
    try {
      return await response.json();
    } catch {
      if (method !== 'GET') throw new UncertainWrite();
      throw new AppError(503, 'AIRTABLE_RESPONSE', 'บริการข้อมูลตอบกลับไม่ถูกต้อง');
    }
  }
  async schema(token: string): Promise<unknown> {
    if (token.length < 12)
      throw new AppError(
        503,
        'SCHEMA_TOKEN_REQUIRED',
        'Schema-read token is required for diagnostics.',
      );
    return this.call(
      'GET',
      new URL(`https://api.airtable.com/v0/meta/bases/${this.config.AIRTABLE_BASE_ID}/tables`),
      undefined,
      token,
    );
  }
  async list(table: Table, formula?: string, fields?: readonly string[]) {
    const records: RecordData[] = [],
      seen = new Set<string>();
    let offset = '';
    do {
      const query = new URLSearchParams({ pageSize: '100' });
      for (const field of fields || []) query.append('fields[]', field);
      if (formula) query.set('filterByFormula', formula);
      if (offset) query.set('offset', offset);
      const page = await this.request('GET', table, '', undefined, query);
      const parsed = z
        .object({ records: z.array(record), offset: z.string().min(1).optional() })
        .safeParse(page);
      if (!parsed.success) throw new AppError(503, 'AIRTABLE_RESPONSE', 'บริการข้อมูลตอบกลับไม่ถูกต้อง');
      records.push(...parsed.data.records);
      offset = parsed.data.offset || '';
      if (offset && seen.has(offset))
        throw new AppError(503, 'AIRTABLE_PAGINATION', 'การโหลดข้อมูลยังไม่สำเร็จ กรุณาลองอีกครั้ง');
      seen.add(offset);
    } while (offset);
    return records;
  }
  async get(table: Table, id: string): Promise<RecordData> {
    const parsed = record.safeParse(await this.request('GET', table, id));
    if (!parsed.success || parsed.data.id !== id)
      throw new AppError(503, 'AIRTABLE_RESPONSE', 'บริการข้อมูลตอบกลับไม่ถูกต้อง');
    return parsed.data;
  }
  async patch(table: Table, id: string, fields: Record<string, unknown>): Promise<RecordData> {
    const parsed = record.safeParse(await this.request('PATCH', table, id, { fields }));
    if (!parsed.success || parsed.data.id !== id) throw new UncertainWrite();
    return parsed.data;
  }
  async upsert(table: Table, key: string, fields: Record<string, unknown>): Promise<RecordData> {
    const response = await this.request('PATCH', table, '', {
      performUpsert: { fieldsToMergeOn: [key] },
      records: [{ fields }],
    });
    const parsed = z.object({ records: z.tuple([record]) }).safeParse(response);
    if (!parsed.success) throw new UncertainWrite();
    return parsed.data.records[0];
  }
}
