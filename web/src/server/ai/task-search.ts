import { z } from 'zod';
import type { User } from '../../domain/model';
import type { AirtableRepository } from '../airtable/client';
import type { Config } from '../config';
import type { Sql } from '../db';
import { aiContext } from './context';

type TaskData = Awaited<ReturnType<typeof aiContext>>;
export type TaskSearch = {
  contractVersion: 1;
  asOf: string;
  scope: string;
  limited: boolean;
  candidates: number;
  items: (Omit<TaskData['context']['items'][number], 'url'> & { id: string })[];
};

export function taskSearchIntent(question: string) {
  if (
    /^(?:ช่วย)?(?:ส่งงาน|สร้างงาน|เพิ่มงาน|งานใหม่)|^(?:ดูร่าง|ยกเลิก|ยืนยันสร้างงาน)$|^(?:ชื่องาน|รายละเอียด|ประเภท|เจ้าของ|Agent|ความเร่งด่วน|กำหนดส่ง|ชื่อตัวแทน|ชื่อลูกค้า)\s*[:：]/i.test(
      question,
    )
  )
    return false;
  if (/hvr-\d+|rec[a-z0-9]{14}|เคสนี้|เคสนั้น|งานนี้|งานนั้น|รายการนี้|รายการนั้น|^แล้ว/i.test(question))
    return false;
  // General daily totals keep their existing summary path. Qualifiers select the search path.
  return /ค้น|หา(?:งาน|เคส)|ติดตาม(?:งาน|เคส)|สถานะ(?:งาน|เคส)|(?:งาน|เคส).*(?:ไหน|อะไร|ที่|เกี่ยว|ของ)|ยังไม่(?:เสร็จ|จบ|ได้)|รอเอกสาร|ขาดเอกสาร|คงค้าง|งานค้าง|ถึงไหน/.test(
    question,
  );
}

export function taskSearchContext(data: TaskData): TaskSearch {
  const items = data.context.items.map(({ url: _url, ...item }, i) => ({
    id: data.taskRefs[i].id,
    ...item,
  }));
  // Never silently search a page or cut off workflow labels that could contain the answer.
  const limited = data.context.truncated || JSON.stringify(items).length > 60000;
  return {
    contractVersion: 1,
    asOf: data.context.asOf,
    scope: data.context.scope,
    limited,
    candidates: data.context.matched,
    items: limited ? [] : items,
  };
}

const selectionSchema = z
  .object({
    taskIds: z.array(z.string().regex(/^rec[a-zA-Z0-9]{14}$/)).max(5),
  })
  .strict();

export async function renderTaskSearchReply(
  db: Sql,
  c: Config,
  repo: AirtableRepository,
  user: User,
  search: TaskSearch,
  text: string,
) {
  const fallback = 'ยังเลือกงานที่ตรงคำถามไม่ได้ กรุณาระบุชื่องาน ประเภท เจ้าของ หรือรหัส HVR เพิ่มเติม';
  let requested: string[];
  try {
    requested = [...new Set(selectionSchema.parse(JSON.parse(text)).taskIds)];
    const allowed = new Set(search.items.map((t) => t.id));
    if (requested.some((id) => !allowed.has(id))) return { answer: fallback, ids: [] };
  } catch {
    return { answer: fallback, ids: [] };
  }
  if (!requested.length)
    return {
      answer: 'ไม่พบงานที่ตรงคำถามจากข้อมูลสรุปที่คุณมีสิทธิ์เห็น ลองระบุชื่องาน ประเภท เจ้าของ หรือรหัส HVR เพิ่มเติม',
      ids: [],
    };
  // Reload fresh projections/workflows; never render a model-authored title, status or link.
  const current = await aiContext(db, c, repo, user, '', [], { ids: requested });
  const indexed = new Map(current.taskRefs.map((t, i) => [t.id, current.context.items[i]]));
  const old = new Map(search.items.map((t) => [t.id, t]));
  const blocks: string[] = [],
    ids: string[] = [];
  let changed = false;
  for (const id of requested) {
    const task = indexed.get(id);
    if (!task) {
      changed = true;
      continue;
    }
    const { url: _url, ...snapshot } = task;
    changed ||= JSON.stringify(old.get(id)) !== JSON.stringify({ id, ...snapshot });
    const w = task.workflow;
    const block = [
      `${blocks.length + 1}. ${task.code} — ${task.title}`,
      `${task.category} · เจ้าของ ${task.owner.slice(0, 100)}`,
      `สถานะ ${task.status} · ${task.priority}`,
      task.dueDate ? `กำหนดส่ง ${task.dueDate}` : 'ยังไม่ระบุกำหนดส่ง',
      w ? `Checklist ที่บังคับ ${w.requiredDone}/${w.requiredTotal} · ติดตามต่อ ${w.continuing}` : '',
      w?.missing?.length
        ? `ยังขาด: ${w.missing.slice(0, 3).join(' / ')}${w.missing.length > 3 ? ' (ดูเพิ่มเติมในงาน)' : ''}`
        : '',
      `เปิดงาน: ${task.url}`,
    ]
      .filter(Boolean)
      .join('\n');
    // Keep full links and remember only entries actually included in the LINE reply.
    if (blocks.join('\n\n').length + block.length > 3500) break;
    blocks.push(block);
    ids.push(id);
  }
  if (!blocks.length) return { answer: 'ข้อมูลงานหรือสิทธิ์เปลี่ยนแล้ว กรุณาค้นใหม่อีกครั้ง', ids: [] };
  const asOf = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(current.context.asOf));
  return {
    answer: [
      changed
        ? 'ข้อมูลงานเปลี่ยนระหว่างค้น แสดงสถานะล่าสุด กรุณาตรวจว่าตรงคำถาม:'
        : 'งานที่ AI เลือกว่าตรงกับคำถาม:',
      ...blocks,
      `ข้อมูล ณ ${asOf} (เวลาไทย) · แสดงไม่เกิน 5 งาน ไม่ใช่ยอดรวม`,
      'หากยังไม่ตรง ระบุชื่องานหรือรหัส HVR เพิ่มเติมได้',
    ].join('\n\n'),
    ids,
  };
}
