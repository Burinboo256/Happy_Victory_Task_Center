import { z } from 'zod';

export const documentCategories = [
  'แบบฟอร์มทั่วไป',
  'ยูนิต ลิงค์',
  'แบบสอบถามฝ่ายพิจารณา',
  'FATCA & CRS',
  'เอกสารทีม',
] as const;
export function documentLink(value: string): { url: string; source: 'allianz' | 'drive' } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (
      ['allianz.co.th', 'www.allianz.co.th', 'azay.co.th', 'www.azay.co.th'].includes(
        url.hostname,
      ) &&
      url.pathname.startsWith('/content/dam/') &&
      /\.pdf$/i.test(url.pathname)
    )
      return { url: url.href, source: 'allianz' };
    if (
      url.hostname === 'drive.google.com' &&
      (/^\/file\/d\/[A-Za-z0-9_-]+\/(view|preview)$/.test(url.pathname) ||
        (url.pathname === '/open' && /^[A-Za-z0-9_-]+$/.test(url.searchParams.get('id') || '')))
    )
      return { url: url.href, source: 'drive' };
  } catch {
    /* Validation returns a public error without echoing the URL. */
  }
  return null;
}
export const documentInput = z
  .object({
    title: z.string().trim().min(1).max(250),
    category: z.enum(documentCategories),
    description: z.string().trim().max(1000),
    keywords: z.array(z.string().trim().min(1).max(80)).max(30),
    audience: z.enum(['all', 'staff']),
    url: z
      .string()
      .trim()
      .max(2048)
      .refine((v) => !!documentLink(v), 'ใช้ลิงก์ PDF Allianz หรือไฟล์ Google Drive'),
    label: z.string().trim().min(1).max(120),
    effectiveDate: z.union([z.literal(''), z.iso.date()]),
    note: z.string().trim().min(1).max(1000),
  })
  .strict();
export type DocumentInput = z.infer<typeof documentInput>;
export type DocumentVersion = {
  id: string;
  documentId: string;
  status: 'draft' | 'published' | 'archived';
  createdBy: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  source: 'allianz' | 'drive';
  data: DocumentInput;
};
export type DocumentEntry = {
  id: string;
  revision: number;
  status: 'active' | 'paused';
  currentId: string | null;
  favorite: boolean;
  version: DocumentVersion;
};
export type DocumentList = {
  items: DocumentEntry[];
  total: number;
  page: number;
  pages: number;
  counts: { published: number; favorites: number; drafts: number; paused: number };
};
export const documentQuery = z.object({
  q: z.string().max(300).default(''),
  category: z.string().max(80).default(''),
  tab: z.enum(['published', 'favorites', 'drafts', 'paused']).default('published'),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
export type DocumentQuery = z.infer<typeof documentQuery>;
export function normalizeDocumentText(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('th')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
export function documentScore(data: DocumentInput, query: string): number {
  const q = normalizeDocumentText(query);
  if (!q) return 1;
  const title = normalizeDocumentText(data.title);
  const aliases = data.keywords.map(normalizeDocumentText);
  if (title === q || aliases.includes(q)) return 100;
  if (title.includes(q)) return 80;
  if (aliases.some((a) => a.includes(q))) return 60;
  const body = normalizeDocumentText(
    `${data.category} ${data.description} ${data.title} ${data.keywords.join(' ')}`,
  );
  if (body.includes(q)) return 40;
  const tokens = q.split(/[\s,;]+/).filter(Boolean);
  return tokens.length > 1 && tokens.every((token) => body.includes(token)) ? 20 : 0;
}
