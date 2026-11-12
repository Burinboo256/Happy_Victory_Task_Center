import { createHash, randomUUID } from 'node:crypto';
import catalogue from '../../data/form-catalogue.json';
import { documentInput } from '../../domain/documents';
import type { User } from '../../domain/model';
import type { Config } from '../config';
import { atomic, type Sql } from '../db';
import { forbidden } from '../errors';

export const catalogueAliases: Record<string, string[]> = {
  'allianz-5': ['ใบนำส่ง', 'ธุรกิจใหม่', 'ยื่นแอป'],
  'allianz-6': ['แก้ไขใบคำขอ', 'แก้แอป'],
  'allianz-7': ['HC1', 'ใบรับรองสุขภาพ', 'สุขภาพ'],
  'allianz-8': ['HC2', 'ใบรับรองสุขภาพ', 'สุขภาพ'],
  'allianz-9': ['ใบชำระเงิน', 'pay in', 'ชำระเบี้ย'],
  'allianz-10': ['เคลม', 'มรณกรรม', 'เสียชีวิต'],
  'allianz-11': ['เคลม', 'OPD', 'ผู้ป่วยนอก'],
  'allianz-14': ['เคลม', 'ทุพพลภาพ'],
  'allianz-16': ['ใบหักบัญชี', 'หักบัญชี', 'DDA', 'DCA', 'ชำระเบี้ย'],
  'allianz-17': ['เวนคืน', 'ยกเลิกกรมธรรม์'],
  'allianz-18': ['กู้กรมธรรม์', 'กู้เงิน'],
  'allianz-19': ['ขอประวัติ', 'ประวัติการรักษา', 'มอบอำนาจ'],
  'allianz-20': ['เคลม', 'AI', 'PA', 'IPD', 'CI', 'ผู้ป่วยใน'],
  'allianz-22': ['ต่ออายุ', 'คืนสถานะ', 'เปลี่ยนแปลงกรมธรรม์'],
  'allianz-23': ['รับเอกสารทางอีเมล'],
  'allianz-24': ['ลดหย่อนภาษี'],
  'allianz-30': ['Suitability Test', 'ประเมินความเสี่ยง'],
  'allianz-32': ['ขอประวัติ', 'ประวัติการรักษา', 'มอบอำนาจ', 'ยูนิต ลิงค์'],
  'allianz-44': ['W-8BEN'],
  'allianz-45': ['W-8BEN-E'],
  'allianz-46': ['W-9'],
};
export function catalogueId(key: string) {
  const hex = createHash('sha256')
    .update('rinlyn:forms:' + key)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function catalogueRows() {
  return catalogue.map((row) => ({
    key: row.id,
    id: catalogueId(row.id),
    needsLinkReview: row.needsLinkReview,
    data: documentInput.parse({
      title: row.title,
      category: row.category,
      description: `แบบฟอร์มในหมวด${row.category} จากหน้าแบบฟอร์มประกันชีวิต Allianz`,
      keywords: catalogueAliases[row.id] || [],
      audience: 'all',
      url: row.url,
      label: 'รายการอ้างอิง 13 พ.ย. 2569',
      effectiveDate: '',
      note:
        'นำเข้าทะเบียนจากหน้า Allianz ตรวจเนื้อหาและสิทธิ์เปิดลิงก์ก่อนเผยแพร่' +
        (row.needsLinkReview ? ' • ลิงก์นี้ยังรอตรวจ' : ''),
    }),
  }));
}
export async function importCatalogue(db: Sql, c: Config, user: User) {
  if (!user.active || user.role !== 'Admin') throw forbidden();
  return atomic(db, async (tx) => {
    const created: string[] = [];
    for (const row of catalogueRows()) {
      const result = await tx.query(
        `INSERT INTO hvr_documents(environment,id,created_by,import_key) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id`,
        [c.APP_ENV, row.id, user.id, row.key],
      );
      if (!result.rows.length) continue;
      const versionId = randomUUID();
      await tx.query(
        'INSERT INTO hvr_document_versions(environment,document_id,id,created_by,payload) VALUES($1,$2,$3,$4,$5::jsonb)',
        [c.APP_ENV, row.id, versionId, user.id, JSON.stringify(row.data)],
      );
      await tx.query(
        `INSERT INTO hvr_document_events(environment,document_id,actor_id,action,after_revision,version_id) VALUES($1,$2,$3,'import_draft',1,$4)`,
        [c.APP_ENV, row.id, user.id, versionId],
      );
      created.push(row.id);
    }
    return { created, skipped: catalogueRows().length - created.length };
  });
}
