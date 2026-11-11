import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  categories,
  priorities,
  priorityNames,
  isManager,
  todayBangkok,
  type User,
} from '../../domain/model';
import type { Sql } from '../db';
import type { Config } from '../config';
import type { AirtableRepository } from '../airtable/client';
import { userDto } from '../airtable/dto';
import { forbidden } from '../errors';
import { requireWrites } from '../runtime';
import { Journal } from '../operations/journal';
import { mutate, validateMutation } from '../services/mutations';
import { ownTask } from '../services/reads';

const fieldsSchema = z
  .object({
    title: z.string().trim().max(180).nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    category: z.enum(categories).nullable().optional(),
    priority: z.enum(priorities).nullable().optional(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s)
      .nullable()
      .optional(),
    agentId: z
      .string()
      .regex(/^rec[a-zA-Z0-9]{14}$/)
      .nullable()
      .optional(),
  })
  .strict();
type Fields = z.infer<typeof fieldsSchema>;
export type Draft = {
  id: string;
  user_id: string;
  line_id: string;
  binding: string;
  role: string;
  revision: number;
  state: string;
  fields: Fields;
  owner_name: string;
  task_id: string | null;
};
export type DraftContext = {
  mode: 'draft';
  today: string;
  timezone: 'Asia/Bangkok';
  current: Fields;
  categories: typeof categories;
  agents: { id: string; name: string }[];
};
export type DraftReply = {
  text: string;
  actions?: { label: string; data: string }[];
  created?: boolean;
  taskId?: string;
};
const stale = 'ร่างนี้เปลี่ยนแล้ว หมดอายุ หรือใช้ไปแล้ว กรุณาพิมพ์ “ดูร่าง” เพื่อตรวจร่างล่าสุด';
const busy = 'กำลังจัดร่างก่อนหน้า กรุณารอสักครู่แล้วส่งข้อความนี้อีกครั้ง';
export const startsDraft = (text: string) => /^(?:ช่วย)?(?:ส่งงาน|สร้างงาน|เพิ่มงาน|งานใหม่)/.test(text);

async function agents(repo: AirtableRepository, user: User) {
  if (!isManager(user)) return [{ id: user.id, name: user.name }];
  return (
    await repo.list('users', 'AND({Active}=TRUE(),{Role}="Agent")', ['Full Name', 'Role', 'Active'])
  )
    .filter((r) => r.fields.Role === 'Agent' && r.fields.Active === true)
    .map(userDto)
    .slice(0, 100)
    .map(({ id, name }) => ({ id, name }));
}
function capability(c: Config, d: Draft, action: string) {
  const data = `draft:${d.id}:${d.revision}:${action}`;
  return (
    data +
    ':' +
    createHmac('sha256', c.AUTH_SECRET)
      .update(`${c.APP_ENV}:${d.user_id}:${d.line_id}:${d.binding}:${data}`)
      .digest('hex')
      .slice(0, 32)
  );
}
function actions(c: Config, d: Draft, confirm = true): DraftReply['actions'] {
  return [
    ...(confirm
      ? [
          {
            label: d.state === 'submitting' ? 'ตรวจผลการสร้างงาน' : 'ยืนยันสร้างงาน',
            data: capability(c, d, 'confirm'),
          },
        ]
      : []),
    ...(d.state === 'submitting'
      ? []
      : [
          { label: 'แก้ไข', data: capability(c, d, 'edit') },
          { label: 'ยกเลิก', data: capability(c, d, 'cancel') },
        ]),
  ];
}
function missing(f: Fields) {
  if (!f.title) return 'ต้องการให้เลขาช่วยทำเรื่องอะไรครับ?';
  if (!f.description) return 'ขอรายละเอียดสิ่งที่ต้องการให้เลขาดำเนินการครับ';
  if (!f.category) return 'งานนี้เป็นประเภทใด: ตัวแทนใหม่ / ตัวแทนเก่า / ลูกค้าใหม่ / ลูกค้าเก่า?';
  if (!f.agentId) return 'Agent เจ้าของงานชื่ออะไรครับ?';
  if (!f.dueDate) return 'กำหนดส่งวันไหนครับ? ระบุวันที่ หรือพิมพ์ “วันนี้” / “พรุ่งนี้” ได้';
  return '';
}
function preview(c: Config, d: Draft): DraftReply {
  const f = d.fields;
  const question = missing(f);
  if (question)
    return {
      text: 'ร่างงานยังไม่ถูกบันทึก\n' + question + '\nพิมพ์ “ยกเลิก” เพื่อหยุด',
      actions: actions(c, d, false),
    };
  if (d.state !== 'ready')
    return {
      text: 'กำลังแก้ร่าง พิมพ์รายละเอียดที่ต้องการแก้ หรือพิมพ์ “ใช้ข้อมูลเดิม” เพื่อจัดร่างให้ยืนยันใหม่',
      actions: actions(c, d, false),
    };
  return {
    text: `ตรวจร่างก่อนสร้างงาน\nชื่องาน: ${f.title}\nประเภท: ${f.category}\nรายละเอียด: ${f.description}\nAgent: ${d.owner_name}\nความเร่งด่วน: ${priorityNames[f.priority || 'Normal']}\nกำหนดส่ง: ${f.dueDate} (เวลาไทย)\nสถานะเริ่มต้น: งานเข้าใหม่\n\nยังไม่สร้างงาน กดยืนยันด้านล่างเมื่อข้อมูลถูกต้อง ร่างมีอายุ 30 นาที`,
    actions: actions(c, d),
  };
}
export async function cleanDrafts(db: Sql, c: Config) {
  // Never discard a submitted operation: recovery must retain its original request ID.
  await db.query(
    `UPDATE hvr_ai_drafts SET state='expired',fields='{}',owner_name=''
    WHERE environment=$1 AND state IN ('collecting','ready') AND expires_at<=clock_timestamp()`,
    [c.APP_ENV],
  );
  await db.query(
    `DELETE FROM hvr_ai_drafts WHERE environment=$1
    AND state IN ('expired','cancelled','completed') AND expires_at<clock_timestamp()-interval '1 day'`,
    [c.APP_ENV],
  );
}
export async function draftInput(
  db: Sql,
  c: Config,
  repo: AirtableRepository,
  user: User,
  sender: string,
  binding: string,
  question: string,
): Promise<{
  reply?: DraftReply;
  context?: DraftContext;
  draft?: Draft;
} | null> {
  await cleanDrafts(db, c);
  // A relink or role change cannot revive an old draft or its confirmation buttons.
  await db.query(
    `UPDATE hvr_ai_drafts SET state='cancelled',fields='{}',owner_name=''
    WHERE environment=$1 AND user_id=$2 AND state IN ('collecting','ready') AND (binding<>$3 OR role<>$4)`,
    [c.APP_ENV, user.id, binding, user.role],
  );
  let d = (
    await db.query(
      `SELECT * FROM hvr_ai_drafts WHERE environment=$1 AND user_id=$2
    AND state IN ('collecting','ready','submitting')`,
      [c.APP_ENV, user.id],
    )
  ).rows[0] as Draft | undefined;
  if (!d && !startsDraft(question)) {
    if (/^(ดูร่าง|ยกเลิก|ยืนยันสร้างงาน)$/.test(question))
      return { reply: { text: 'ไม่มีร่างงาน พิมพ์ “ส่งงาน” ตามด้วยรายละเอียดเพื่อเริ่มได้ครับ' } };
    return null;
  }
  if (d && (d.binding !== binding || d.role !== user.role || d.line_id !== sender))
    return { reply: { text: 'มีคำขอเดิมกำลังตรวจสอบ กรุณาตรวจงานในเว็บหรือติดต่อผู้ดูแลก่อนส่งงานใหม่' } };
  if (d?.state === 'submitting')
    return {
      reply: { text: 'รับการยืนยันแล้ว กดตรวจผลเพื่อใช้คำขอเดิม กรุณาอย่าส่งงานซ้ำ', actions: actions(c, d) },
    };
  if (d && question === 'ยกเลิก') {
    const cancelled = await db.query(
      `UPDATE hvr_ai_drafts SET state='cancelled',fields='{}',owner_name=''
      WHERE environment=$1 AND id=$2 AND state IN ('collecting','ready') RETURNING id`,
      [c.APP_ENV, d.id],
    );
    return { reply: { text: cancelled.rows.length ? 'ยกเลิกร่างแล้ว ยังไม่ได้สร้างงาน' : stale } };
  }
  if (d && /^(ดูร่าง|ยืนยันสร้างงาน)$/.test(question)) return { reply: preview(c, d) };
  // Summary questions still work while a draft is open.
  if (d && /^(สรุป|สถานะ|งานไหน)/.test(question)) return null;
  await requireWrites(db, c);
  const owners = await agents(repo, user);
  if (!owners.length) return { reply: { text: 'ยังไม่มี Agent ที่เปิดใช้งาน กรุณาให้ผู้ดูแลตรวจบัญชีในเว็บก่อน' } };
  if (!d) {
    d = (
      await db.query(
        `INSERT INTO hvr_ai_drafts(environment,user_id,line_id,binding,role,fields)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING *`,
        [
          c.APP_ENV,
          user.id,
          sender,
          binding,
          user.role,
          JSON.stringify({ priority: 'Normal', ...(!isManager(user) ? { agentId: user.id } : {}) }),
        ],
      )
    ).rows[0] as Draft | undefined;
    if (!d) return { reply: { text: busy } };
  }
  const next = (
    await db.query(
      `UPDATE hvr_ai_drafts SET revision=revision+1,state='collecting',
    generation_until=clock_timestamp()+interval '90 seconds'
    WHERE environment=$1 AND id=$2 AND revision=$3 AND state IN ('collecting','ready')
    AND (generation_until IS NULL OR generation_until<clock_timestamp()) RETURNING *`,
      [c.APP_ENV, d.id, d.revision],
    )
  ).rows[0] as Draft | undefined;
  if (!next) return { reply: { text: busy } };
  return {
    draft: next,
    context: {
      mode: 'draft',
      today: todayBangkok(),
      timezone: 'Asia/Bangkok',
      current: next.fields,
      categories,
      agents: owners,
    },
  };
}

// Model output can only change a draft. It cannot confirm or invoke mutations.
export async function finishDraft(
  db: Sql,
  c: Config,
  repo: AirtableRepository,
  user: User,
  id: string,
  revision: number,
  binding: string,
  text: string,
): Promise<DraftReply> {
  const d = (
    await db.query(
      `SELECT * FROM hvr_ai_drafts WHERE environment=$1 AND id=$2
    AND user_id=$3 AND binding=$4 AND role=$5 AND revision=$6 AND state='collecting' AND expires_at>clock_timestamp()`,
      [c.APP_ENV, id, user.id, binding, user.role, revision],
    )
  ).rows[0] as Draft | undefined;
  if (!d) return { text: stale };
  let fields: Fields;
  let ownerName = '';
  try {
    const proposed = fieldsSchema.parse(JSON.parse(text));
    fields = {
      ...d.fields,
      ...proposed,
      priority: proposed.priority || d.fields.priority || 'Normal',
    };
    if (!isManager(user)) fields.agentId = user.id;
    const owners = await agents(repo, user);
    const owner = owners.find((a) => a.id === fields.agentId);
    if (!owner) fields.agentId = null;
    else ownerName = owner.name;
  } catch {
    await db.query(
      `UPDATE hvr_ai_drafts SET generation_until=NULL WHERE environment=$1 AND id=$2 AND revision=$3 AND state='collecting'`,
      [c.APP_ENV, id, revision],
    );
    return { text: 'AI จัดร่างไม่สำเร็จ ยังไม่สร้างงาน กรุณาส่งรายละเอียดอีกครั้ง หรือพิมพ์ “ยกเลิก”' };
  }
  const state = missing(fields) ? 'collecting' : 'ready';
  const saved = (
    await db.query(
      `UPDATE hvr_ai_drafts SET fields=$4,owner_name=$5,state=$6,generation_until=NULL
    WHERE environment=$1 AND id=$2 AND revision=$3 AND state='collecting' AND expires_at>clock_timestamp() RETURNING *`,
      [c.APP_ENV, id, revision, JSON.stringify(fields), ownerName, state],
    )
  ).rows[0] as Draft | undefined;
  return saved ? preview(c, saved) : { text: stale };
}

export async function draftPostback(
  db: Sql,
  c: Config,
  repo: AirtableRepository,
  user: User,
  sender: string,
  binding: string,
  data: string,
): Promise<DraftReply> {
  const match = /^draft:([a-f0-9-]{36}):(\d{1,9}):(confirm|edit|cancel):([a-f0-9]{32})$/.exec(data);
  if (!match || !z.uuid().safeParse(match[1]).success) return { text: stale };
  const d = (
    await db.query(
      `SELECT * FROM hvr_ai_drafts WHERE environment=$1 AND id=$2 AND user_id=$3
    AND line_id=$4 AND binding=$5 AND role=$6 AND revision=$7`,
      [c.APP_ENV, match[1], user.id, sender, binding, user.role, Number(match[2])],
    )
  ).rows[0] as Draft | undefined;
  if (!d) return { text: stale };
  const expected = capability(c, d, match[3]);
  if (data.length !== expected.length || !timingSafeEqual(Buffer.from(data), Buffer.from(expected)))
    throw forbidden();
  if (match[3] !== 'confirm') {
    const edited = await db.query(
      `UPDATE hvr_ai_drafts SET state=$4,revision=revision+1,generation_until=NULL,
      fields=CASE WHEN $4='cancelled' THEN '{}'::jsonb ELSE fields END
      WHERE environment=$1 AND id=$2 AND revision=$3 AND state IN ('collecting','ready') AND expires_at>clock_timestamp() RETURNING id`,
      [c.APP_ENV, d.id, d.revision, match[3] === 'cancel' ? 'cancelled' : 'collecting'],
    );
    return {
      text: !edited.rows.length
        ? stale
        : match[3] === 'cancel'
          ? 'ยกเลิกร่างแล้ว ยังไม่ได้สร้างงาน'
          : 'พิมพ์สิ่งที่ต้องการแก้ไข เช่น “เปลี่ยนกำหนดส่งเป็นพรุ่งนี้” แล้วตรวจร่างใหม่ก่อนยืนยัน',
    };
  }
  if (d.state === 'completed' && d.task_id) return completedReply(repo, c, user, d.task_id);
  await requireWrites(db, c);
  // Re-check the binding and owner immediately before claiming the immutable payload.
  if (
    !(
      await db.query(
        `SELECT 1 FROM hvr_ai_accounts WHERE environment=$1 AND user_id=$2 AND binding=$3 AND line_id=$4`,
        [c.APP_ENV, user.id, binding, sender],
      )
    ).rows.length
  )
    throw forbidden();
  const fresh = userDto(await repo.get('users', user.id));
  if (!fresh.active || fresh.role !== d.role) throw forbidden();
  if (missing(d.fields) || !d.fields.agentId) return { text: stale };
  const owner = userDto(await repo.get('users', d.fields.agentId));
  if (!owner.active || owner.role !== 'Agent' || (!isManager(fresh) && owner.id !== fresh.id))
    throw forbidden();
  const claimed = (
    await db.query(
      `UPDATE hvr_ai_drafts SET state='submitting'
    WHERE environment=$1 AND id=$2 AND revision=$3
    AND ((state='ready' AND expires_at>clock_timestamp()) OR state='submitting') RETURNING *`,
      [c.APP_ENV, d.id, d.revision],
    )
  ).rows[0];
  if (!claimed) return { text: stale };
  const payload = validateMutation('create', { ...d.fields, referenceUrl: '' }, fresh);
  const outcome = await new Journal(db, c).execute(
    user.id,
    d.id,
    'create',
    payload,
    `create:${user.id}:${d.id}`,
    (steps) => mutate(repo, fresh, 'create', payload, steps),
  );
  if (outcome.state !== 'completed' || !outcome.result)
    return {
      text: 'รับคำขอแล้ว ยังตรวจสอบการบันทึกอยู่ กรุณาตรวจผลคำขอเดิม หรือตรวจในเว็บก่อนส่งใหม่',
      actions: actions(c, { ...d, state: 'submitting' }),
    };
  await db.query(
    `UPDATE hvr_ai_drafts SET state='completed',task_id=$3 WHERE environment=$1 AND id=$2 AND state='submitting'`,
    [c.APP_ENV, d.id, outcome.result.id],
  );
  return completedReply(repo, c, fresh, outcome.result.id);
}
async function completedReply(
  repo: AirtableRepository,
  c: Config,
  user: User,
  id: string,
): Promise<DraftReply> {
  const task = await ownTask(repo, user, id);
  return {
    created: true,
    taskId: id,
    text: `สร้างงานแล้ว: ${task.code || task.title}\n${c.APP_ORIGIN}/tasks/${id}\nตรวจรายละเอียดและติดตามสถานะได้ในเว็บ`,
  };
}
