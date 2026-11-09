import { z } from 'zod';

export const onboardingCategory = 'ตัวแทนใหม่';
const text = z.string().trim().max(600);
const day = z
  .string()
  .refine(
    (s) =>
      s === '' ||
      (/^\d{4}-\d{2}-\d{2}$/.test(s) &&
        !Number.isNaN(Date.parse(s)) &&
        new Date(s).toISOString().slice(0, 10) === s),
  );
const named = z.object({
  id: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/),
  name: z.string().trim().min(1).max(120),
});
const unique = (items: { id: string }[]) => new Set(items.map((i) => i.id)).size === items.length;
export const templateSchema = z.object({
  modules: z.array(named).min(1).max(20).refine(unique),
  documents: z.array(named).max(30).refine(unique),
});
export type WorkflowTemplate = z.infer<typeof templateSchema>;
export const defaultTemplate: WorkflowTemplate = {
  modules: ['Smart Start', 'Training 2', 'Training 3', 'Training 4'].map((name, i) => ({
    id: 'module-' + (i + 1),
    name,
  })),
  documents: [],
};
const tracking = { followupDate: day, notes: text };
export const workflowSchema = z
  .object({
    notice: z.object({ date: day, acknowledged: z.boolean(), ...tracking }),
    training: z.object({
      combined: z.boolean(),
      date: day,
      place: text,
      status: z.enum(['pending', 'booked', 'attended']),
      ...tracking,
    }),
    exams: z
      .array(
        z.object({
          id: z.uuid(),
          date: day,
          status: z.enum(['booked', 'waiting', 'passed', 'failed', 'postponed']),
          ...tracking,
        }),
      )
      .max(30)
      .refine(unique),
    documents: z
      .array(named.extend({ requestedDate: day, receivedDate: day, ...tracking }))
      .max(30)
      .refine(unique),
    documentsConfirmed: z.boolean(),
    issue: z.object({
      submittedDate: day,
      code: z.string().trim().max(80),
      issuedDate: day,
      ...tracking,
    }),
    modules: z
      .array(
        named.extend({
          status: z.enum(['pending', 'booked', 'completed']),
          date: day,
          ...tracking,
        }),
      )
      .min(1)
      .max(20)
      .refine(unique),
  })
  .superRefine((s, ctx) => {
    const reject = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (s.notice.acknowledged && !s.notice.date) reject('ระบุวันที่แจ้งอบรม');
    if (s.training.status !== 'pending' && !s.training.date) reject('ระบุวันอบรม');
    if (s.exams.some((e) => !e.date)) reject('ระบุวันที่ของแต่ละรอบสอบ');
    if (s.modules.some((m) => m.status !== 'pending' && !m.date)) reject('ระบุวันอบรม Module');
    const passed = s.exams.some((e) => e.status === 'passed');
    if (
      !passed &&
      (s.documentsConfirmed ||
        s.documents.some((d) => d.requestedDate || d.receivedDate) ||
        s.issue.submittedDate ||
        s.issue.code ||
        s.issue.issuedDate)
    )
      reject('ต้องบันทึกผลสอบผ่านก่อนดำเนินการเอกสารและรหัส');
    if (s.documentsConfirmed && s.documents.some((d) => !d.receivedDate))
      reject('ยังได้รับเอกสารไม่ครบ');
    if ((s.issue.submittedDate || s.issue.code || s.issue.issuedDate) && !s.documentsConfirmed)
      reject('ยืนยันเอกสารครบก่อนยื่นออกรหัส');
    if (Boolean(s.issue.code) !== Boolean(s.issue.issuedDate)) reject('ระบุทั้งรหัสตัวแทนและวันที่ได้รับรหัส');
    if (s.issue.code && !s.issue.submittedDate) reject('ระบุวันที่ยื่นออกรหัส');
  });
export type Onboarding = z.infer<typeof workflowSchema>;
export const blankTracking = () => ({ followupDate: '', notes: '' });
export function newWorkflow(template: WorkflowTemplate): Onboarding {
  return {
    notice: { date: '', acknowledged: false, ...blankTracking() },
    training: { combined: false, date: '', place: '', status: 'pending', ...blankTracking() },
    exams: [],
    documents: template.documents.map((d) => ({
      ...d,
      requestedDate: '',
      receivedDate: '',
      ...blankTracking(),
    })),
    documentsConfirmed: false,
    issue: { submittedDate: '', code: '', issuedDate: '', ...blankTracking() },
    modules: template.modules.map((m) => ({
      ...m,
      date: '',
      status: 'pending',
      ...blankTracking(),
    })),
  };
}
export function workflowSummary(s: Onboarding) {
  const passed = s.exams.some((e) => e.status === 'passed');
  const stages = [
    s.notice.acknowledged && !!s.notice.date,
    s.training.status === 'attended',
    passed,
    s.documentsConfirmed && s.documents.every((d) => !!d.receivedDate),
    !!s.issue.code && !!s.issue.issuedDate,
    s.modules.length > 0 && s.modules.every((m) => m.status === 'completed'),
  ];
  const pending: { date: string; label: string }[] = [];
  const add = (done: boolean, date: string, label: string) => {
    if (!done && date) pending.push({ date, label });
  };
  add(stages[0], s.notice.followupDate, 'แจ้งวันอบรม');
  add(stages[1], s.training.followupDate || s.training.date, 'อบรมก่อนสอบ');
  if (!passed)
    s.exams
      .filter((e) => !['failed', 'postponed'].includes(e.status))
      .forEach((e) => {
        add(false, e.followupDate || e.date, 'สอบ / ผลสอบ');
      });
  s.documents.forEach((d) => {
    add(!!d.receivedDate, d.followupDate, 'เอกสาร: ' + d.name);
  });
  add(stages[4], s.issue.followupDate, 'ออกรหัสตัวแทน');
  s.modules.forEach((m) => {
    add(m.status === 'completed', m.followupDate || m.date, 'อบรม: ' + m.name);
  });
  pending.sort((a, b) => a.date.localeCompare(b.date));
  return {
    stages,
    complete: stages.every(Boolean),
    modulesDone: s.modules.filter((m) => m.status === 'completed').length,
    modulesTotal: s.modules.length,
    nextDate: pending[0]?.date || '',
    nextLabel: pending[0]?.label || '',
    pending,
    modules: s.modules.map(({ id, name, status, date }) => ({ id, name, status, date })),
  };
}
export type WorkflowSummary = ReturnType<typeof workflowSummary>;
export interface WorkflowView {
  version: number;
  templateVersion: number;
  summary: WorkflowSummary;
  state?: Onboarding;
  history?: { version: number; actor: string; at: string; summary: string }[];
}
export const stageNames = [
  'แจ้งวันอบรม',
  'จองและเข้าอบรม',
  'สอบผ่าน',
  'เอกสารครบ',
  'ได้รับรหัสตัวแทน',
  'อบรมครบทุก Module',
];
