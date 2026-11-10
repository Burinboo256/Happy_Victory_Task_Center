import { z } from 'zod';
import {
  caseDefinitions,
  caseStateSchema,
  newCaseState,
  validateCaseState,
  caseSummary,
  type CaseView,
} from '../../domain/case-workflow';
import { isManager, type TaskSummary, type User } from '../../domain/model';
import type { Sql } from '../db';
import type { Config } from '../config';
import type { AirtableRepository } from '../airtable/client';
import { ownTask } from './reads';
import { saveWorkflowRecord } from './onboarding';
import { AppError, forbidden } from '../errors';
import { canonical } from '../operations/journal';
type Environment = Pick<Config, 'APP_ENV'>;
export const caseInput = z.object({ version: z.int().min(0), state: caseStateSchema });
export async function readCaseWorkflow(
  db: Sql,
  config: Environment,
  task: TaskSummary,
  manager: boolean,
): Promise<CaseView | undefined> {
  if (!caseDefinitions[task.category]) return undefined;
  const resource = 'case:' + task.id;
  const row = (
    await db.query(
      'SELECT version,payload FROM hvr_workflows WHERE environment=$1 AND resource=$2',
      [config.APP_ENV, resource],
    )
  ).rows[0];
  const state = row ? validateCaseState(row.payload) : newCaseState(task.category);
  if (state.category !== task.category)
    throw new AppError(
      409,
      'CATEGORY_CHANGED',
      'ประเภทงานเปลี่ยนแล้ว กรุณาติดต่อผู้ดูแลเพื่อทบทวน Workflow เดิม',
    );
  const summary = caseSummary(state);
  if (!manager)
    return {
      version: row?.version || 0,
      category: task.category,
      summary: { ...summary, pending: [], nextDate: '', nextLabel: '', missing: [] },
    };
  const history = (
    await db.query(
      'SELECT version,actor_name,created_at,summary FROM hvr_workflow_history WHERE environment=$1 AND resource=$2 ORDER BY version DESC LIMIT 50',
      [config.APP_ENV, resource],
    )
  ).rows;
  return {
    version: row?.version || 0,
    category: task.category,
    state,
    summary,
    history: history.map((h) => ({
      version: h.version,
      actor: h.actor_name,
      at: new Date(h.created_at).toISOString(),
      summary: h.summary,
    })),
  };
}
export async function saveCaseWorkflow(
  db: Sql,
  config: Environment,
  repo: AirtableRepository,
  user: User,
  id: string,
  input: z.infer<typeof caseInput>,
  operationKey: string,
) {
  if (!isManager(user)) throw forbidden();
  const task = await ownTask(repo, user, id);
  if (!caseDefinitions[task.category] || input.state.category !== task.category)
    throw new AppError(422, 'WORKFLOW_CATEGORY', 'ประเภท Workflow ไม่ตรงกับงาน');
  if (task.status === 'Cancelled')
    throw new AppError(409, 'TASK_CLOSED', 'เปิดงานอีกครั้งก่อนแก้ Workflow');
  if (
    (
      await db.query(
        'SELECT version FROM hvr_workflow_history WHERE environment=$1 AND operation_key=$2 AND resource=$3',
        [config.APP_ENV, operationKey, 'case:' + id],
      )
    ).rows.length
  )
    return { id };
  const current = await readCaseWorkflow(db, config, task, true);
  if (!current?.state) throw new AppError(409, 'WORKFLOW_CATEGORY', 'ไม่พบ Workflow ของงาน');
  if (current.version !== input.version)
    throw new AppError(409, 'VERSION_CONFLICT', 'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่ก่อนแก้ไข');
  const state = validateCaseState(input.state),
    previous = current.state;
  if (task.status === 'Completed') {
    const mandatory = caseDefinitions[task.category].sections
      .flatMap((s) => s.items)
      .filter((i) => i.required);
    if (
      canonical(state.fields) !== canonical(previous.fields) ||
      mandatory.some((i) => canonical(state.items[i.id]) !== canonical(previous.items[i.id]))
    )
      throw new AppError(
        409,
        'TASK_CLOSED',
        'หลังปิดงานแก้ได้เฉพาะรายการติดตามต่อและทางเลือก หากแก้ข้อมูลหลักให้เปิดงานก่อน',
      );
  }
  const changed = caseDefinitions[task.category].sections
    .filter((s) =>
      s.items.some((i) => canonical(state.items[i.id]) !== canonical(previous.items[i.id])),
    )
    .map((s) => s.title);
  if (canonical(state.fields) !== canonical(previous.fields)) changed.push('ข้อมูลประกอบเคส');
  await saveWorkflowRecord(
    db,
    config,
    'case:' + id,
    input.version,
    state,
    user,
    operationKey,
    'บันทึก: ' + (changed.join(', ') || 'เริ่มติดตามตามประเภทงาน'),
  );
  return { id };
}
export async function requireCaseComplete(
  db: Sql,
  config: Environment,
  repo: AirtableRepository,
  user: User,
  id: string,
) {
  const task = await ownTask(repo, user, id);
  if (task.status === 'Completed') return;
  const view = await readCaseWorkflow(db, config, task, false);
  if (view && !view.summary.complete)
    throw new AppError(
      409,
      'WORKFLOW_INCOMPLETE',
      'ยังปิดงานไม่ได้ กรุณาทำรายการบังคับและข้อมูลประกอบเคสให้ครบ',
    );
}
export async function attachCaseSummaries(db: Sql, config: Environment, tasks: TaskSummary[]) {
  const selected = tasks.filter((t) => !!caseDefinitions[t.category]);
  if (!selected.length) return tasks;
  const rows = (
    await db.query(
      'SELECT resource,payload FROM hvr_workflows WHERE environment=$1 AND resource=ANY($2::text[])',
      [config.APP_ENV, selected.map((t) => 'case:' + t.id)],
    )
  ).rows;
  return tasks.map((task) => {
    if (!caseDefinitions[task.category]) return task;
    const row = rows.find((r) => r.resource === 'case:' + task.id);
    if (row && row.payload.category !== task.category)
      return { ...task, workflowSummary: 'ประเภทเปลี่ยน — กรุณาทบทวน Workflow' };
    const s = caseSummary(row ? validateCaseState(row.payload) : newCaseState(task.category));
    return {
      ...task,
      continuingFollowup: task.status === 'Completed' && !!s.nextDate,
      followupDate: [task.followupDate, s.nextDate].filter(Boolean).sort()[0] || '',
      workflowSummary:
        `ขั้นตอนบังคับ ${s.requiredDone}/${s.requiredTotal}` + (s.nextLabel ? ' · ' + s.nextLabel : ''),
    };
  });
}
