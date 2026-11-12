import { z } from 'zod';
import { documentScore, normalizeDocumentText, type DocumentEntry } from '../../domain/documents';
import type { User } from '../../domain/model';
import type { Config } from '../config';
import type { Sql } from '../db';
import { publishedDocuments } from '../documents/service';
import type { DocumentRef, MemoryTurn } from './memory';

export type AiDocuments = {
  contractVersion: 2;
  query: string;
  favorites: boolean;
  total: number;
  followup: boolean;
  clarify: boolean;
  mixed: boolean;
  asOf: string;
  items: {
    id: string;
    versionId: string;
    title: string;
    category: string;
    description: string;
    label: string;
    source: string;
  }[];
};
export function documentIntent(question: string, memory: MemoryTurn[] = []) {
  if (/^(?:ช่วย)?(?:ส่งงาน|สร้างงาน|เพิ่มงาน|งานใหม่)|^(ดูร่าง|ยกเลิก|ยืนยันสร้างงาน)$/.test(question))
    return false;
  const explicit =
    /แบบฟอร์ม|ฟอร์ม|ขอ(?:ลิงก์|เอกสาร|ประวัติ)|เปิดเอกสาร|หาเอกสาร|มีเอกสาร|เอกสาร.*(?:อะไร|ไหน|บ้าง)|ติดดาว|ใช้บ่อย|\bhc[12]\b|fatca|crs|w-8ben|w-9|ใบหักบัญชี/i.test(
      question,
    );
  return (
    explicit ||
    (!!memory.at(-1)?.document_refs?.length &&
      /รายการที่|เอกสารนี้|ฉบับนี้|^แล้ว(?:รายการ|ฉบับ|เอกสาร)/.test(question))
  );
}
export function mixedDocumentQuestion(question: string) {
  return /hvr-\d+|rec[a-z0-9]{14}|สรุปงาน|สถานะงาน|สถานะเคส|เคส(?:นี้|ไหน)|งาน(?:วันนี้|ลูกค้า|ตัวแทน)/i.test(
    question,
  );
}
export function documentSearchPhrase(question: string) {
  const code = /\b(?:hc[12]|w-8ben-e|w-8ben|w-9|fatca|crs|opd|ipd)\b/i.exec(question)?.[0];
  if (code) return code;
  if (/ยูนิต\s*ลิงค|unit\s*link/i.test(question)) return 'ยูนิต ลิงค์';
  if (/หักบัญชี|หักชำระ|dda|dca/i.test(question)) return 'หักบัญชี';
  if (/ประวัติ(?:การรักษา)?|ขอประวัติ/.test(question)) return 'ขอประวัติ';
  return normalizeDocumentText(question)
    .replace(/hvr-\d+|rec[a-z0-9]{14}/gi, '')
    .replace(
      /ขอเอกสารที่ฉันติดดาวไว้|รายการโปรด|ที่ฉันติดดาวไว้|ติดดาว|ใช้บ่อย|มีอะไรบ้าง|มีไหม|อะไรบ้าง|ขอ(?:ลิงก์|เอกสาร|ฟอร์ม|แบบฟอร์ม)|ช่วย(?:หา|ค้นหา)|แบบฟอร์ม|เอกสาร|ฟอร์ม|ลิงก์|กรุณา|หน่อย|ครับ|ค่ะ|คะ|ได้ไหม|ไหม|สำหรับ|ต้องใช้|อยากได้/g,
      ' ',
    )
    .replace(/^มี/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
export async function currentDocumentMemory(db: Sql, c: Config, user: User, memory: MemoryTurn[]) {
  if (!memory.some((t) => t.document_refs?.length)) return memory;
  if (!c.FORMS_ENABLED || !c.AI_FORMS_ENABLED)
    return memory.filter((t) => !t.document_refs?.length);
  const allowed = new Map((await publishedDocuments(db, c, user)).map((d) => [d.id, d.version.id]));
  return memory.filter((t) =>
    (t.document_refs || []).every((r) => allowed.get(r.id) === r.versionId),
  );
}
export async function aiDocuments(
  db: Sql,
  c: Config,
  user: User,
  question: string,
  memory: MemoryTurn[],
): Promise<AiDocuments> {
  const all = await publishedDocuments(db, c, user);
  const favorites = /ติดดาว|ใช้บ่อย|รายการโปรด/.test(question);
  const last = memory.at(-1)?.document_refs || [];
  const ordinal = /รายการ(?:ที่)?\s*(หนึ่ง|สอง|สาม|สี่|ห้า|[1-5])/.exec(question)?.[1];
  const index = ordinal
    ? ['หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า'].includes(ordinal)
      ? ['หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า'].indexOf(ordinal)
      : Number(ordinal) - 1
    : null;
  const followup = !!ordinal || /เอกสารนี้|ฉบับนี้/.test(question);
  let clarify = false;
  const query = favorites || followup ? '' : documentSearchPhrase(question);
  let matched: DocumentEntry[];
  if (followup) {
    const ref = index !== null ? last[index] : last.length === 1 ? last[0] : undefined;
    matched = ref ? all.filter((d) => d.id === ref.id && d.version.id === ref.versionId) : [];
    clarify = !matched.length;
  } else {
    matched = all
      .filter((d) => !favorites || d.favorite)
      .map((d) => ({ d, score: documentScore(d.version.data, query) }))
      .filter(({ score }) => score > 0)
      .sort(
        (a, b) =>
          b.score - a.score || a.d.version.data.title.localeCompare(b.d.version.data.title, 'th'),
      )
      .map(({ d }) => d);
  }
  return {
    contractVersion: 2,
    query,
    favorites,
    total: matched.length,
    followup,
    clarify,
    mixed: mixedDocumentQuestion(question),
    asOf: new Date().toISOString(),
    items: matched.slice(0, 5).map((d) => ({
      id: d.id,
      versionId: d.version.id,
      title: d.version.data.title,
      category: d.version.data.category,
      description: d.version.data.description.slice(0, 350),
      label: d.version.data.label,
      source: d.version.source,
    })),
  };
}
export function documentRefs(context: AiDocuments): DocumentRef[] {
  return context.items.map((d) => ({ id: d.id, versionId: d.versionId }));
}
const modelReply = z
  .object({ documentIds: z.array(z.uuid()).max(5), taskAnswer: z.string().max(1200).optional() })
  .strict();
export async function renderDocumentReply(
  db: Sql,
  c: Config,
  user: User,
  context: AiDocuments,
  text: string,
  taskUrls: string[] = [],
) {
  // Never render model-supplied URLs, document names, or descriptive instructions.
  let parsed: z.infer<typeof modelReply> | undefined;
  try {
    parsed = modelReply.parse(JSON.parse(text));
  } catch {
    /* Deterministic search-result fallback. */
  }
  const allowed = new Set(context.items.map((d) => d.id));
  if (parsed?.documentIds.some((id) => !allowed.has(id))) parsed = undefined;
  const requested = parsed?.documentIds.length
    ? [...new Set(parsed.documentIds)]
    : context.items.map((d) => d.id);
  const current = new Map((await publishedDocuments(db, c, user)).map((d) => [d.id, d]));
  const selected = requested.map((id) => current.get(id)).filter((d): d is DocumentEntry => !!d);
  const changed = context.items.some((old) => current.get(old.id)?.version.id !== old.versionId);
  const parts: string[] = [];
  if (context.mixed) {
    const answer = parsed?.taskAnswer || '';
    const urls = answer.match(/https?:\/\/[^\s<>]+/g) || [];
    parts.push(
      answer && !changed && urls.every((url) => taskUrls.includes(url))
        ? answer
        : 'สรุปงานส่วนนี้ยังไม่พร้อม กรุณาถามสถานะงานแยกอีกครั้ง',
    );
  }
  if (context.clarify) parts.push('กรุณาระบุชื่อเอกสารหรือค้นใหม่ เพื่อเลือกฉบับที่ถูกต้อง');
  else if (!selected.length) parts.push('ไม่พบเอกสารที่เผยแพร่และคุณมีสิทธิ์เข้าถึง ลองระบุชื่อหรือรหัสเอกสารเพิ่ม');
  else {
    parts.push(
      changed
        ? 'ทะเบียนเอกสารเปลี่ยนแล้ว แสดงฉบับที่เผยแพร่ปัจจุบัน:'
        : context.favorites
          ? 'เอกสารใช้บ่อยของคุณ:'
          : `พบเอกสารที่เกี่ยวข้อง${context.total > selected.length ? ` แสดง ${selected.length} จาก ${context.total} รายการ ณ เวลาค้นหา` : ''}:`,
    );
    selected.forEach((d, i) => {
      parts.push(
        `${i + 1}. ${d.version.data.title}\n${d.version.data.category} · ${d.version.source === 'drive' ? 'Google Drive' : 'Allianz'}\n${d.version.data.description.slice(0, 180)}\nเปิดเอกสาร: ${c.APP_ORIGIN}/forms/${d.id}/open`,
      );
    });
  }
  parts.push(
    `ค้นต่อในเว็บ: ${c.APP_ORIGIN}/forms${context.query && !changed ? '?q=' + encodeURIComponent(context.query) : ''}`,
  );
  const answer = parts.join('\n\n');
  return {
    answer:
      answer.length > 4400
        ? parts
            .filter((_, i) => !context.mixed || i !== 0)
            .join('\n\n')
            .slice(0, 4400)
        : answer,
    refs: selected.map((d) => ({ id: d.id, versionId: d.version.id })),
  };
}
