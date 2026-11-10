import {
  caseDefinitions,
  caseSummary,
  newCaseState,
  validateCaseState,
} from '../../domain/case-workflow';
import {
  isManager,
  isOpen,
  priorityNames,
  statusNames,
  todayBangkok,
  type User,
} from '../../domain/model';
import { formulaValue, type AirtableRepository } from '../airtable/client';
import { taskDto, taskSummaryFields, publicUserFields, userDto } from '../airtable/dto';
import type { Sql } from '../db';
import type { Config } from '../config';
import { forbidden } from '../errors';

// Projection deliberately excludes descriptions, comments, attachments and case field values.
export async function aiContext(
  db: Sql,
  config: Config,
  repo: AirtableRepository,
  user: User,
  question: string,
) {
  if (!user.active) throw forbidden();
  const records = await repo.list(
    'tasks',
    isManager(user) ? undefined : `{Agent Record ID}=${formulaValue(user.id)}`,
    [
      ...taskSummaryFields.filter((f) => f !== 'Description'),
      'Created At',
      'Completed At',
      'Last Update',
    ],
  );
  const tasks = records
    .filter(
      (r) => isManager(user) || (Array.isArray(r.fields.Agent) && r.fields.Agent.includes(user.id)),
    )
    .map(taskDto);
  const today = todayBangkok();
  const dayOf = (value: string) => (value ? todayBangkok(new Date(value)) : '');
  const totals = {
    all: tasks.length,
    open: tasks.filter(isOpen).length,
    new: tasks.filter((t) => t.status === 'New').length,
    overdue: tasks.filter((t) => isOpen(t) && t.dueDate && t.dueDate < today).length,
    dueToday: tasks.filter((t) => isOpen(t) && t.dueDate === today).length,
    urgent: tasks.filter((t) => isOpen(t) && t.priority === 'Urgent').length,
    completedToday: tasks.filter((t) => t.status === 'Completed' && dayOf(t.completedAt) === today)
      .length,
    createdToday: tasks.filter((t) => dayOf(t.createdAt) === today).length,
    byStatus: Object.fromEntries(
      Object.entries(statusNames).map(([key, name]) => [
        name,
        tasks.filter((t) => t.status === key).length,
      ]),
    ),
  };
  const names = new Map<string, string>();
  names.set(user.id, user.name);
  if (isManager(user))
    for (const r of await repo.list('users', undefined, publicUserFields)) {
      if (['Agent', 'Secretary', 'Admin'].includes(String(r.fields.Role)))
        names.set(r.id, userDto(r).name);
    }
  const q = question.toLocaleLowerCase();
  const codes = q.match(/hvr-\d+|rec[a-z0-9]{14}/g);
  let selected = tasks;
  if (codes)
    selected = selected.filter(
      (t) => codes.includes(t.code.toLowerCase()) || codes.includes(t.id.toLowerCase()),
    );
  else {
    const owners = [...names]
      .filter(([, name]) => name.length > 2 && q.includes(name.toLowerCase()))
      .map(([id]) => id);
    if (owners.length) selected = selected.filter((t) => owners.includes(t.agentId));
    const category = Object.keys(caseDefinitions).find((c) => q.includes(c));
    if (category) selected = selected.filter((t) => t.category === category);
    if (/เกินกำหนด|เลยกำหนด|overdue/.test(q))
      selected = selected.filter((t) => isOpen(t) && t.dueDate && t.dueDate < today);
    else if (/ด่วน|urgent/.test(q))
      selected = selected.filter((t) => isOpen(t) && ['Urgent', 'High'].includes(t.priority));
    else if (/เสร็จ.*วันนี้|วันนี้.*เสร็จ/.test(q))
      selected = selected.filter((t) => t.status === 'Completed' && dayOf(t.completedAt) === today);
    else if (/กำหนด.*วันนี้|วันนี้.*กำหนด/.test(q))
      selected = selected.filter((t) => isOpen(t) && t.dueDate === today);
  }
  selected.sort(
    (a, b) =>
      Number(isOpen(b)) - Number(isOpen(a)) ||
      Number(b.priority === 'Urgent') - Number(a.priority === 'Urgent') ||
      (a.dueDate || '9999').localeCompare(b.dueDate || '9999') ||
      a.code.localeCompare(b.code),
  );
  const matched = selected.length;
  selected = selected.slice(0, 60);
  const rows = selected.length
    ? (
        await db.query(
          'SELECT resource,payload FROM hvr_workflows WHERE environment=$1 AND resource=ANY($2::text[])',
          [config.APP_ENV, selected.map((t) => 'case:' + t.id)],
        )
      ).rows
    : [];
  const workflows = new Map(rows.map((r) => [r.resource, r.payload]));
  const items = selected.map((t) => {
    let workflow:
      | {
          requiredDone: number;
          requiredTotal: number;
          complete: boolean;
          continuing: number;
          pending?: { date: string; label: string }[];
          missing?: string[];
        }
      | undefined;
    if (caseDefinitions[t.category]) {
      const state = workflows.has('case:' + t.id)
        ? validateCaseState(workflows.get('case:' + t.id))
        : newCaseState(t.category);
      if (state.category === t.category) {
        const summary = caseSummary(state);
        workflow = {
          requiredDone: summary.requiredDone,
          requiredTotal: summary.requiredTotal,
          complete: summary.complete,
          continuing: summary.continuing,
          ...(isManager(user) ? { pending: summary.pending, missing: summary.missing } : {}),
        };
      }
    }
    return {
      code: t.code,
      title: t.title.slice(0, 200),
      category: t.category,
      owner: names.get(t.agentId) || 'ตัวแทน',
      status: statusNames[t.status],
      priority: priorityNames[t.priority],
      dueDate: t.dueDate,
      ...(isManager(user) ? { followupDate: t.followupDate } : {}),
      completedAt: t.completedAt,
      workflow,
      url: config.APP_ORIGIN + '/tasks/' + t.id,
    };
  });
  return {
    taskIds: tasks.map((t) => t.id),
    context: {
      asOf: new Date().toISOString(),
      timezone: 'Asia/Bangkok',
      today,
      scope: isManager(user) ? 'งานทั้งหมดที่มีสิทธิ์' : 'งานของฉันเท่านั้น',
      totals,
      matched,
      included: items.length,
      truncated: matched > items.length,
      items,
      limitations:
        'ไม่มีรายละเอียดส่วนตัว เอกสารแนบ หรือข้อความอัปเดตในคำตอบนี้ ยอดรวมเป็นภาพรวมตามสิทธิ์ ส่วนรายการกรองตามคำถามและแสดงได้ไม่เกิน 60 งาน หากต้องการเคสเฉพาะให้ระบุรหัส HVR',
    },
  };
}
