import { z } from 'zod';

export type CaseItem = { id: string; label: string; required: boolean; skippable?: boolean };
export type CaseSection = { id: string; title: string; items: CaseItem[] };
export type CaseField = { id: string; label: string; type?: 'date' | 'number'; options?: string[] };
export type CaseDefinition = { sections: CaseSection[]; fields: CaseField[] };
const section = (id: string, title: string, labels: string[], required = true): CaseSection => ({
  id,
  title,
  items: labels.map((label, i) => ({ id: `${id}-${i + 1}`, label, required })),
});
const optional = (s: CaseSection, indexes: number[]) => ({
  ...s,
  items: s.items.map((item, i) => (indexes.includes(i + 1) ? { ...item, skippable: true } : item)),
});
export const caseDefinitions: Record<string, CaseDefinition> = {
  ตัวแทนใหม่: {
    sections: [
      section('prepare', '1.1 เตรียมสมัคร อบรม และสอบ', [
        'ขอข้อมูลส่วนตัวและเอกสารประกอบให้ครบ',
        'ตรวจสอบว่าผู้สมัครต้องอบรมอย่างเดียว / อบรมพร้อมสอบ / สอบอย่างเดียว',
        'สมัครอบรมและ/หรือสอบให้ตรงประเภท',
        'ส่งวัน เวลา สถานที่ และสิ่งที่ต้องเตรียมให้ผู้สมัคร',
        'แจ้งเตือนก่อนวันอบรมและสอบ',
        'ติดตามผลการอบรมและผลสอบ',
      ]),
      section('code', '1.2 ลงทะเบียนและขอออกรหัส', [
        'ติดตามการลงทะเบียน คปภ. ทาง LINE',
        'ติดตามการลงทะเบียน คปภ. ทางเว็บไซต์',
        'เตรียมเอกสารขอออกรหัสตัวแทน',
        'ส่งลิงก์ให้ตัวแทนกรอกข้อมูล และติดตามจนเสร็จ',
        'ส่งลิงก์ให้คนค้ำกรอกข้อมูล และติดตามจนเสร็จ',
        'ตรวจความครบถ้วนก่อนส่งเรื่อง',
        'ติดตามจนรหัสออก และแจ้งตัวแทนกับแม่ตาล',
      ]),
      section('welcome', '1.3 ต้อนรับและเริ่มงาน — บังคับถึงลงทะเบียนอบรม', [
        'ทำ Greeting ต้อนรับเข้าทีม',
        'จัดทำนามบัตร ตรวจชื่อ รหัส และช่องทางติดต่อ',
        'เตรียมคอนเทนต์เปิดตัวให้ตัวแทนตรวจและยืนยันก่อนโพสต์',
        'ประสานสอนติดตั้งและเข้าใช้งานแอป Allianz บนมือถือและ iPad',
        'ลงทะเบียนอบรม Smart Start',
        'ลงทะเบียนอบรม HiPro',
      ]),
      section(
        'continue',
        '1.3 ติดตามต่อหลังลงทะเบียน — ไม่ขวางการปิดงานหลัก',
        [
          'ติดตามการเข้าเรียน Smart Start',
          'ติดตามการเข้าเรียน HiPro',
          'ติดตาม First App หรือเคสแรก พร้อมประสานผู้ช่วยดูแลเคส',
          'เตรียมคอนเทนต์ฉลอง First App โดยขออนุญาตก่อนใช้ข้อมูลหรือภาพลูกค้า',
        ],
        false,
      ),
      section(
        'develop',
        '1.4 พัฒนาต่อยอด — ทางเลือก',
        [
          'ประสานสมัครเรียน IC',
          'สมัครสอบ IC และติดตามผล',
          'ติดตามขั้นตอนการขอใบอนุญาต IC',
          'ประสานเรียน Unit Linked และติดตามขั้นตอนที่ต้องทำต่อให้ครบ',
        ],
        false,
      ),
    ],
    fields: [
      {
        id: 'applicationMode',
        label: 'ประเภทสมัครอบรม/สอบ',
        options: ['อบรมอย่างเดียว', 'อบรมพร้อมสอบ', 'สอบอย่างเดียว'],
      },
      { id: 'trainingDate', label: 'วันอบรม', type: 'date' },
      { id: 'examDate', label: 'วันสอบ', type: 'date' },
      { id: 'trainingResult', label: 'ผลการอบรม' },
      { id: 'examResult', label: 'ผลสอบ / ผลสอบเดิม' },
      { id: 'agentCode', label: 'รหัสตัวแทนที่ออกแล้ว' },
      { id: 'smartStartDate', label: 'วันเรียน Smart Start', type: 'date' },
      { id: 'hiProDate', label: 'วันเรียน HiPro', type: 'date' },
    ],
  },
  ตัวแทนเก่า: {
    sections: [
      optional(
        section('retain', 'รักษาสัญญาและเติบโต', [
          'ติดตามยอดรักษาสัญญา 48,000 PC ตามเป้าหมายที่แม่ตาลระบุ',
          'บันทึกยอดสะสม ยอดที่ยังขาด และวันครบกำหนดของแต่ละคน',
          'แจ้งเตือนล่วงหน้า พร้อมประสานแม่ตาลหากต้องช่วยวางแผน',
          'ทำรายชื่อผู้ตั้งเป้าขึ้น AL ผ่าน Go for Team',
          'ติดตามความคืบหน้าตามเกณฑ์โครงการที่ใช้อยู่',
          'สรุปสิ่งที่ยังขาดและนัดคุยแผนกับแม่ตาล',
        ]),
        [4, 5, 6],
      ),
    ],
    fields: [
      { id: 'pcTarget', label: 'เป้าหมาย PC ที่แม่ตาลระบุ', type: 'number' },
      { id: 'pcAccumulated', label: 'ยอด PC สะสม', type: 'number' },
      { id: 'deadline', label: 'วันครบกำหนดรักษาสัญญา', type: 'date' },
      { id: 'programCriteria', label: 'เกณฑ์ Go for Team ที่ใช้อยู่ / สิ่งที่ยังขาด' },
    ],
  },
  ลูกค้าใหม่: {
    sections: [
      optional(
        section('application', '3.1 ยื่นแอปและก่อนอนุมัติ', [
          'รับข้อมูลและตรวจเอกสารจากตัวแทน',
          'คีย์แอปและตรวจความถูกต้องก่อนส่ง',
          'บันทึกเลขที่ใบคำขอ วันที่ส่ง และตัวแทนเจ้าของเคส',
          'ติดตาม Memo และแจ้งสิ่งที่ต้องดำเนินการให้ตัวแทนทราบ',
          'ประสานขอประวัติการรักษา และ/หรือนัดตรวจสุขภาพตามที่ร้องขอ',
          'เตรียมชุดเอกสาร 4 ใบ ให้ตัวแทน พร้อมตรวจว่าครบและเป็นฉบับที่ถูกต้อง',
          'ติดตามเอกสารและผลตรวจจนส่งครบ',
          'ติดตามผลพิจารณาอนุมัติ',
          'หากมี CTF ให้ประสานลูกค้าลงนามและส่งอีเมล พร้อมเก็บหลักฐานการส่ง',
        ]),
        [4, 5, 9],
      ),
      section('policy', '3.2 หลังกรมธรรม์อนุมัติ', [
        'แจ้งผลและเงื่อนไขอนุมัติให้ตัวแทนตรวจสอบ',
        'ประสานให้ลูกค้ากดรับ Freelook และตรวจวันที่เริ่มนับสิทธิตามเอกสารบริษัท',
        'ติดตามให้ตัวแทนกดรับเล่มกรมธรรม์',
        'ประสานส่งมอบกรมธรรม์และนัดอธิบายความคุ้มครอง',
        'บันทึกวันครบกำหนดชำระเบี้ยปีถัดไป',
        'ปิดงานเมื่อส่งมอบครบ พร้อมบันทึกหลักฐาน',
      ]),
    ],
    fields: [
      { id: 'applicationNumber', label: 'เลขที่ใบคำขอ' },
      { id: 'submittedDate', label: 'วันที่ส่งใบคำขอ', type: 'date' },
      { id: 'freelookStart', label: 'วันเริ่มนับ Freelook ตามเอกสารบริษัท', type: 'date' },
      { id: 'nextPremiumDate', label: 'วันครบกำหนดเบี้ยปีถัดไป', type: 'date' },
      { id: 'deliveryEvidence', label: 'หลักฐานการส่งมอบ / ที่เก็บเอกสาร' },
    ],
  },
  ลูกค้าเก่า: {
    sections: [
      optional(
        section('renewal', 'ดูแลชำระเบี้ยต่ออายุ', [
          'ตรวจรายชื่อลูกค้าที่ใกล้ครบกำหนดชำระเบี้ย',
          'ตรวจยอดเบี้ย วันครบกำหนด และช่องทางชำระ',
          'ส่งข้อความแจ้งเตือน พร้อมแจ้งตัวแทนเจ้าของลูกค้า',
          'ติดตามสถานะจนยืนยันว่าชำระเรียบร้อย',
          'หากติดต่อไม่ได้หรือมีปัญหาชำระเบี้ย ให้แจ้งตัวแทนและแม่ตาล',
        ]),
        [5],
      ),
    ],
    fields: [
      { id: 'premium', label: 'ยอดเบี้ย', type: 'number' },
      { id: 'premiumDue', label: 'วันครบกำหนดชำระเบี้ย', type: 'date' },
      { id: 'paymentChannel', label: 'ช่องทางชำระ' },
      { id: 'paymentDate', label: 'วันที่ยืนยันชำระแล้ว', type: 'date' },
    ],
  },
  วันเกิดตัวแทนและลูกค้า: {
    sections: [
      section('birthday', 'วันเกิดตัวแทนและลูกค้า', [
        'ตรวจรายชื่อวันเกิดล่วงหน้าทุกสัปดาห์',
        'เตรียมข้อความหรือการ์ดอวยพร ตรวจชื่อและรูปให้ถูกต้อง',
        'แจ้งเตือนแม่ตาลและตัวแทนเจ้าของลูกค้า',
        'บันทึกว่าส่งคำอวยพรแล้ว',
      ]),
    ],
    fields: [
      { id: 'birthdayDate', label: 'วันเกิดที่ติดตามในรอบนี้', type: 'date' },
      { id: 'greetingDate', label: 'วันที่ส่งคำอวยพร', type: 'date' },
    ],
  },
  งานเคลม: {
    sections: [
      optional(
        section('claim', 'ติดตามงานเคลมจนจบ', [
          'รับเรื่องและบันทึกตัวแทนเจ้าของเคส',
          'ตรวจรายการเอกสารที่ต้องใช้ตามประเภทเคลม',
          'แจ้งเอกสารที่ยังขาดให้ชัดเจน',
          'ติดตามเอกสารจนส่งครบ',
          'บันทึกวันที่ส่ง เลขอ้างอิง และช่องทางติดตาม',
          'ติดตามสถานะและเอกสารเพิ่มเติม',
          'แจ้งความคืบหน้าให้ตัวแทนทราบ',
          'ติดตามผลและการรับเงิน ก่อนปิดงาน',
        ]),
        [3, 6],
      ),
    ],
    fields: [
      { id: 'claimType', label: 'ประเภทเคลม' },
      { id: 'claimSubmitted', label: 'วันที่ส่งเคลม', type: 'date' },
      { id: 'claimReference', label: 'เลขอ้างอิงเคลม' },
      { id: 'trackingChannel', label: 'ช่องทางติดตาม' },
      { id: 'claimResult', label: 'ผลเคลม / ผลการรับเงิน' },
    ],
  },
};
export const caseDate = z
  .string()
  .refine(
    (s) =>
      s === '' ||
      (/^\d{4}-\d{2}-\d{2}$/.test(s) &&
        !Number.isNaN(Date.parse(s)) &&
        new Date(s).toISOString().slice(0, 10) === s),
  );
const itemState = z.object({
  status: z.enum(['pending', 'done', 'na']),
  followupDate: caseDate,
  notes: z.string().trim().max(600),
});
export const caseStateSchema = z.object({
  schemaVersion: z.literal(1),
  category: z.string(),
  items: z.record(z.string(), itemState),
  fields: z.record(z.string(), z.string().trim().max(600)),
});
export type CaseState = z.infer<typeof caseStateSchema>;
export function newCaseState(category: string): CaseState {
  const definition = caseDefinitions[category];
  if (!definition) throw new Error('Unsupported workflow category');
  return {
    schemaVersion: 1,
    category,
    items: Object.fromEntries(
      definition.sections
        .flatMap((s) => s.items)
        .map((item) => [item.id, { status: 'pending', followupDate: '', notes: '' }]),
    ),
    fields: Object.fromEntries(
      definition.fields.map((f) => [f.id, f.id === 'pcTarget' ? '48000' : '']),
    ),
  };
}
export function validateCaseState(input: unknown): CaseState {
  const state = caseStateSchema.parse(input),
    definition = caseDefinitions[state.category];
  if (!definition) throw new Error('Unsupported workflow category');
  const items = definition.sections.flatMap((s) => s.items);
  const fail = (message: string): never => {
    throw new z.ZodError([{ code: 'custom', path: [], message }]);
  };
  if (Object.keys(state.items).length !== items.length || items.some((i) => !state.items[i.id]))
    fail('ต้องเก็บรายการติดตามให้ครบ');
  for (const item of items) {
    const value = state.items[item.id];
    if (value.status === 'na' && ((!item.skippable && item.required) || !value.notes))
      fail('รายการนี้ข้ามไม่ได้ หรือต้องระบุเหตุผลที่ไม่ใช้กับเคสนี้');
  }
  if (
    Object.keys(state.fields).length !== definition.fields.length ||
    definition.fields.some((f) => !(f.id in state.fields))
  )
    fail('ข้อมูลเคสไม่ครบตามแบบ');
  for (const field of definition.fields) {
    const value = state.fields[field.id];
    if (field.type === 'date' && !caseDate.safeParse(value).success) fail('วันที่ไม่ถูกต้อง');
    if (
      value &&
      field.type === 'number' &&
      (!/^\d+(\.\d{1,2})?$/.test(value) || !Number.isFinite(Number(value)) || Number(value) > 1e12)
    )
      fail('ยอดต้องเป็นตัวเลขตั้งแต่ศูนย์ขึ้นไป');
    if (value && field.options && !field.options.includes(value)) fail('ตัวเลือกไม่ถูกต้อง');
  }
  return state;
}
export function caseSummary(state: CaseState) {
  const sections = caseDefinitions[state.category].sections.map((s) => ({
    id: s.id,
    title: s.title,
    required: s.items.some((i) => i.required),
    done: s.items.filter((i) => state.items[i.id].status !== 'pending').length,
    total: s.items.length,
  }));
  const items = caseDefinitions[state.category].sections.flatMap((s) => s.items);
  const required = items.filter((i) => i.required);
  const pending = items
    .filter((i) => state.items[i.id].status === 'pending' && state.items[i.id].followupDate)
    .map((i) => ({ date: state.items[i.id].followupDate, label: i.label }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const missing = required
    .filter((i) => state.items[i.id].status === 'pending')
    .map((i) => i.label);
  // These values identify the actual case; checkboxes alone cannot replace them.
  const requiredFields: Record<string, string[]> = {
    ตัวแทนใหม่: ['applicationMode', 'agentCode'],
    ตัวแทนเก่า: ['pcTarget', 'pcAccumulated', 'deadline'],
    ลูกค้าใหม่: [
      'applicationNumber',
      'submittedDate',
      'freelookStart',
      'nextPremiumDate',
      'deliveryEvidence',
    ],
    ลูกค้าเก่า: ['premium', 'premiumDue', 'paymentChannel', 'paymentDate'],
    วันเกิดตัวแทนและลูกค้า: ['birthdayDate', 'greetingDate'],
    งานเคลม: ['claimType', 'claimSubmitted', 'claimReference', 'trackingChannel', 'claimResult'],
  };
  for (const id of requiredFields[state.category] || [])
    if (!state.fields[id])
      missing.push(caseDefinitions[state.category].fields.find((f) => f.id === id)?.label || id);
  return {
    sections,
    complete: missing.length === 0,
    requiredDone: required.filter((i) => state.items[i.id].status !== 'pending').length,
    requiredTotal: required.length,
    missing,
    pending,
    nextDate: pending[0]?.date || '',
    nextLabel: pending[0]?.label || '',
    continuing: items.filter((i) => !i.required && state.items[i.id].status === 'pending').length,
  };
}
export type CaseSummary = ReturnType<typeof caseSummary>;
export type CaseView = {
  version: number;
  category: string;
  summary: CaseSummary;
  state?: CaseState;
  history?: { version: number; actor: string; at: string; summary: string }[];
};
