import catalogue from '../../data/form-catalogue.json';
export const sourcePage = 'https://www.allianz.co.th/th_TH/services/form-download.html';
export const categories = ['แบบฟอร์มทั่วไป', 'ยูนิต ลิงค์', 'แบบสอบถามฝ่ายพิจารณา', 'FATCA & CRS'] as const;
export type Category = (typeof categories)[number];
export type Version = {
  id: string;
  label: string;
  url: string;
  source: 'official' | 'upload';
  fileName?: string;
  effectiveDate: string;
  note: string;
  status: 'published' | 'draft' | 'archived';
};
export type FormDocument = {
  id: string;
  title: string;
  category: Category;
  description: string;
  keywords: string;
  size?: string;
  needsLinkReview?: boolean;
  currentId: string | null;
  versions: Version[];
};

export function initialDocuments(): FormDocument[] {
  return catalogue.map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category as Category,
    description: `รายการจากหมวด ${row.category} ในหน้าแบบฟอร์มประกันชีวิต Allianz`,
    keywords: `${row.category} ${row.id === 'allianz-19' || row.id === 'allianz-32' ? 'ขอประวัติ โรงพยาบาล มอบอำนาจ' : ''} ${row.id === 'allianz-16' ? 'หักบัญชี DDA DCA' : ''}`,
    size: row.size,
    needsLinkReview: row.needsLinkReview,
    currentId: `${row.id}-initial`,
    versions: [
      {
        id: `${row.id}-initial`,
        label: 'รายการอ้างอิง 13 พ.ย. 2569',
        url: row.url,
        source: 'official',
        effectiveDate: '',
        note: `อ้างอิงชื่อและลิงก์จากหน้าดาวน์โหลด Allianz วันที่ 13 พ.ย. 2569 ยังไม่ได้รับรองเลขฉบับหรือเก็บสำเนาไฟล์${row.size ? ` • ขนาดตามหน้าเว็บ: ${row.size}` : ''}${row.needsLinkReview ? ' • เครื่องมือตรวจอ่านไฟล์นี้ไม่สำเร็จ ต้องตรวจลิงก์ก่อนนำขึ้นใช้งานจริง' : ''}`,
        status: 'published',
      },
    ],
  }));
}
