import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  anniversary,
  eventKinds,
  initialCare,
  leadDays,
  policyKinds,
  type CarePolicy,
  type CareEvent,
} from '../../domain/customer-care';
import { isManager, todayBangkok, type User } from '../../domain/model';
import { atomic, type Sql } from '../db';
import type { Config } from '../config';
import type { AirtableRepository } from '../airtable/client';
import { userDto } from '../airtable/dto';
import { AppError, forbidden } from '../errors';
import { requireWrites } from '../runtime';

const day = z.iso.date().refine((v) => v >= '1900-01-01' && v <= '2199-12-31');
const note = z.string().trim().max(300);
const operation = z.uuid();
const policyId = z.uuid();
const command = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create'),
      operation,
      customer: z.string().trim().min(1).max(100),
      reference: z.string().trim().min(1).max(64),
      agentId: z.string().regex(/^rec[A-Za-z0-9]{14}$/),
      kind: z.enum(policyKinds),
      started: day,
      premium: day.optional(),
      ends: day.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('schedule'),
      operation,
      policyId,
      kind: z.enum(eventKinds),
      due: day,
      recipient: z.enum(['team', 'agent']),
      note,
    })
    .strict(),
  z
    .object({
      action: z.literal('finish'),
      operation,
      policyId,
      eventId: z.uuid(),
      outcome: z.enum(['done', 'retry', 'handoff']),
      note,
      next: day.optional(),
    })
    .strict(),
  z.object({ action: z.literal('close'), operation, policyId }).strict(),
]);
const invalid = (message: string) => new AppError(422, 'CARE_DATE', message);
type Context = { db: Sql; config: Config; user: User; repo: AirtableRepository };
export async function careAlerts(c: Context) {
  const result = await c.db.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE e.due < $3::date)::int AS late
    FROM hvr_care_events e JOIN hvr_care_policies p ON p.id=e.policy_id
    WHERE p.environment=$1 AND ($2 OR p.agent_id=$4) AND NOT p.closed AND e.outcome IS NULL
    AND e.due <= $3::date + (($5::jsonb ->> e.kind)::int)`,
    [c.config.APP_ENV, isManager(c.user), todayBangkok(), c.user.id, JSON.stringify(leadDays)],
  );
  return result.rows[0];
}
export async function careRoster(c: Context) {
  const result = await c.db.query<CarePolicy>(
    `SELECT p.id,p.customer,p.reference,p.agent_id AS "agentId",p.kind,p.started::text,p.ends::text,p.closed,
      COALESCE(jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'due',e.due::text,'recipient',e.recipient,'note',e.note,'outcome',e.outcome,'resultNote',e.result_note,'completedAt',e.completed_at) ORDER BY e.due,e.id) FILTER (WHERE e.id IS NOT NULL),'[]') AS events
      FROM hvr_care_policies p LEFT JOIN hvr_care_events e ON e.policy_id=p.id
      WHERE p.environment=$1 AND ($2 OR p.agent_id=$3) GROUP BY p.id ORDER BY p.closed,p.customer,p.reference`,
    [c.config.APP_ENV, isManager(c.user), c.user.id],
  );
  return { policies: result.rows, today: todayBangkok() };
}
function addEvent(
  db: Sql,
  id: string,
  kind: CareEvent['kind'],
  due: string,
  recipient = 'team',
  message = '',
) {
  return db.query(
    'INSERT INTO hvr_care_events(policy_id,kind,due,recipient,note) VALUES($1,$2,$3,$4,$5)',
    [id, kind, due, recipient, message],
  );
}
export async function saveCare(c: Context, input: unknown) {
  const data = command.parse(input),
    today = todayBangkok();
  await requireWrites(c.db, c.config);
  const manager = isManager(c.user);
  if (data.action === 'create') {
    if (!manager && data.agentId !== c.user.id) throw forbidden();
    const agent = userDto(await c.repo.get('users', data.agentId));
    if (!agent.active || agent.role !== 'Agent') throw invalid('กรุณาเลือกตัวแทนที่ใช้งานใน Space นี้');
    if (
      (data.ends && data.ends < data.started) ||
      (data.premium && (data.premium < data.started || (data.ends && data.premium > data.ends)))
    )
      throw invalid('ตรวจวันเริ่มสัญญา วันชำระเบี้ย และวันครบสัญญาอีกครั้ง');
  }
  if (data.action === 'close' && !manager) throw forbidden();
  return atomic(c.db, async (db) => {
    const hash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    const op = await db.query(
      `INSERT INTO hvr_care_operations(environment,actor,id,payload_hash) VALUES($1,$2,$3,$4)
      ON CONFLICT DO NOTHING RETURNING id`,
      [c.config.APP_ENV, c.user.id, data.operation, hash],
    );
    if (!op.rows.length) {
      const prior = await db.query(
        'SELECT payload_hash FROM hvr_care_operations WHERE environment=$1 AND actor=$2 AND id=$3',
        [c.config.APP_ENV, c.user.id, data.operation],
      );
      if (prior.rows[0]?.payload_hash !== hash)
        throw new AppError(409, 'CARE_CONFLICT', 'ข้อมูลคำขอเปลี่ยนไป กรุณาโหลดใหม่');
      return { saved: true };
    }
    if (data.action === 'create') {
      const row = await db.query(
        `INSERT INTO hvr_care_policies(id,environment,customer,reference,agent_id,kind,started,ends)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id`,
        [
          data.operation,
          c.config.APP_ENV,
          data.customer,
          data.reference,
          data.agentId,
          data.kind,
          data.started,
          data.ends,
        ],
      );
      if (!row.rows.length) throw new AppError(409, 'CARE_DUPLICATE', 'ตัวแทนมีกรมธรรม์อ้างอิงนี้อยู่แล้ว');
      for (const e of initialCare(data.started, today, data.premium, data.ends))
        await addEvent(db, data.operation, e.kind, e.due);
      return { saved: true };
    }
    const record = await db.query(
      `SELECT started::text,ends::text,closed FROM hvr_care_policies WHERE id=$1 AND environment=$2 AND ($3 OR agent_id=$4) FOR UPDATE`,
      [data.policyId, c.config.APP_ENV, manager, c.user.id],
    );
    const policy = record.rows[0];
    if (!policy) throw forbidden();
    if (policy.closed) throw new AppError(409, 'CARE_CLOSED', 'รายการนี้สิ้นสุดการติดตามแล้ว');
    if (data.action === 'close') {
      await db.query('UPDATE hvr_care_policies SET closed=true WHERE id=$1', [data.policyId]);
    } else if (data.action === 'schedule') {
      await addEvent(db, data.policyId, data.kind, data.due, data.recipient, data.note);
    } else {
      const event = (
        await db.query(
          'SELECT kind, due::text, recipient, outcome FROM hvr_care_events WHERE id=$1 AND policy_id=$2',
          [data.eventId, data.policyId],
        )
      ).rows[0];
      if (!event || event.outcome)
        throw new AppError(409, 'CARE_EVENT', 'รายการนัดเปลี่ยนแล้ว กรุณาโหลดใหม่');
      if (data.outcome !== 'done' && !data.next) throw invalid('กรุณาเลือกวันติดตามต่อ');
      if (data.next && (data.next < today || (data.outcome === 'done' && data.next <= event.due)))
        throw invalid('กรุณาเลือกวันติดตามถัดไปให้ถูกต้อง');
      await db.query(
        'UPDATE hvr_care_events SET completed_at=now(),completed_by=$2,outcome=$3,result_note=$4 WHERE id=$1',
        [data.eventId, c.user.id, data.outcome, data.note],
      );
      let next = data.next;
      if (!next && event.kind === 'review') {
        let year = Math.max(+today.slice(0, 4), +event.due.slice(0, 4) + 1);
        if (anniversary(policy.started, year) <= today) year++;
        next = anniversary(policy.started, year);
        if (policy.ends && next > policy.ends) next = undefined;
      }
      if (next)
        await addEvent(
          db,
          data.policyId,
          event.kind,
          next,
          data.outcome === 'handoff' ? 'agent' : event.recipient,
          data.outcome === 'done' ? '' : data.note,
        );
    }
    return { saved: true };
  });
}
