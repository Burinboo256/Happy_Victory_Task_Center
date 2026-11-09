import { z } from 'zod';
import {
  defaultTemplate,
  newWorkflow,
  onboardingCategory,
  templateSchema,
  workflowSchema,
  workflowSummary,
  stageNames,
  type Onboarding,
  type WorkflowTemplate,
  type WorkflowView,
} from '../../domain/onboarding';
import { isManager, isOpen, type User, type TaskSummary } from '../../domain/model';
import type { Sql } from '../db';
import type { Config } from '../config';
import type { AirtableRepository } from '../airtable/client';
import { AppError, forbidden } from '../errors';
import { ownTask } from './reads';
import { canonical } from '../operations/journal';

type Environment = Pick<Config, 'APP_ENV'>;
const conflict = () => new AppError(409, 'VERSION_CONFLICT', 'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่ก่อนแก้ไข');
export async function readTemplate(db: Sql, config: Environment) {
  const row = (
    await db.query(
      'SELECT version,payload FROM hvr_workflows WHERE environment=$1 AND resource=$2',
      [config.APP_ENV, 'template'],
    )
  ).rows[0];
  return {
    version: row?.version || 0,
    template: row ? templateSchema.parse(row.payload) : structuredClone(defaultTemplate),
  };
}
function labels(state: Onboarding, template: WorkflowTemplate) {
  return {
    ...state,
    modules: state.modules.map((m) => ({
      ...m,
      name: template.modules.find((t) => t.id === m.id)?.name || m.name,
    })),
  };
}
export function readWorkflow(
  db: Sql,
  config: Environment,
  taskId: string,
  manager: true,
): Promise<WorkflowView & { state: Onboarding }>;
export function readWorkflow(
  db: Sql,
  config: Environment,
  taskId: string,
  manager: boolean,
): Promise<WorkflowView>;
export async function readWorkflow(
  db: Sql,
  config: Environment,
  taskId: string,
  manager: boolean,
): Promise<WorkflowView> {
  const template = await readTemplate(db, config);
  const row = (
    await db.query(
      'SELECT version,payload FROM hvr_workflows WHERE environment=$1 AND resource=$2',
      [config.APP_ENV, 'task:' + taskId],
    )
  ).rows[0];
  const state = labels(
    row ? workflowSchema.parse(row.payload) : newWorkflow(template.template),
    template.template,
  );
  const summary = workflowSummary(state);
  if (!manager)
    return {
      version: row?.version || 0,
      templateVersion: template.version,
      summary: { ...summary, pending: [], nextDate: '', nextLabel: '' },
    };
  const history = (
    await db.query(
      'SELECT version,actor_name,created_at,summary FROM hvr_workflow_history WHERE environment=$1 AND resource=$2 ORDER BY version DESC LIMIT 50',
      [config.APP_ENV, 'task:' + taskId],
    )
  ).rows;
  return {
    version: row?.version || 0,
    templateVersion: template.version,
    state,
    summary,
    history: history.map((r) => ({
      version: r.version,
      actor: r.actor_name,
      at: new Date(r.created_at).toISOString(),
      summary: r.summary,
    })),
  };
}
// One statement atomically saves state and audit. The operation key makes a lost response safe to replay.
async function save(
  db: Sql,
  config: Environment,
  resource: string,
  version: number,
  payload: unknown,
  user: User,
  operationKey: string,
  summary: string,
) {
  const prior = await db.query(
    'SELECT version FROM hvr_workflow_history WHERE environment=$1 AND operation_key=$2 AND resource=$3',
    [config.APP_ENV, operationKey, resource],
  );
  if (prior.rows.length) return;
  const result = await db.query(
    `WITH saved AS (
    INSERT INTO hvr_workflows(environment,resource,version,payload,operation_key)
    SELECT $1,$2,1,$4::jsonb,$5 WHERE $3::integer=0 OR EXISTS(SELECT 1 FROM hvr_workflows WHERE environment=$1 AND resource=$2 AND version=$3)
    ON CONFLICT(environment,resource) DO UPDATE SET version=hvr_workflows.version+1,payload=EXCLUDED.payload,operation_key=EXCLUDED.operation_key
    WHERE hvr_workflows.version=$3 RETURNING environment,resource,version,payload,operation_key
  ) INSERT INTO hvr_workflow_history(environment,resource,version,payload,operation_key,actor_id,actor_name,summary)
    SELECT environment,resource,version,payload,operation_key,$6,$7,$8 FROM saved RETURNING version`,
    [
      config.APP_ENV,
      resource,
      version,
      JSON.stringify(payload),
      operationKey,
      user.id,
      user.name,
      summary,
    ],
  );
  if (!result.rows.length) throw conflict();
}
export const workflowInput = z.object({
  version: z.int().min(0),
  templateVersion: z.int().min(0),
  state: workflowSchema,
});
export const templateInput = z.object({ version: z.int().min(0), template: templateSchema });
export async function saveWorkflow(
  db: Sql,
  config: Environment,
  repo: AirtableRepository,
  user: User,
  id: string,
  input: z.infer<typeof workflowInput>,
  operationKey: string,
) {
  if (!isManager(user)) throw forbidden();
  const task = await ownTask(repo, user, id);
  if (task.category !== onboardingCategory)
    throw new AppError(422, 'WORKFLOW_CATEGORY', 'Workflow นี้ใช้เฉพาะงานตัวแทนใหม่');
  if (!isOpen(task)) throw new AppError(409, 'TASK_CLOSED', 'เปิดงานอีกครั้งก่อนแก้ Workflow');
  // Check replay before version comparison: the previous SQL commit may have succeeded.
  if (
    (
      await db.query(
        'SELECT version FROM hvr_workflow_history WHERE environment=$1 AND operation_key=$2 AND resource=$3',
        [config.APP_ENV, operationKey, 'task:' + id],
      )
    ).rows.length
  )
    return { id };
  const current = await readWorkflow(db, config, id, true);
  if (current.version !== input.version || current.templateVersion !== input.templateVersion)
    throw conflict();
  const state = workflowSchema.parse(input.state),
    previous = current.state;
  if (
    state.modules.length !== previous.modules.length ||
    previous.modules.some((m) => !state.modules.some((n) => n.id === m.id))
  )
    throw new AppError(422, 'MODULES_REQUIRED', 'ต้องติดตาม Module ครบตามรายการเดิม');
  for (const key of ['exams', 'documents'] as const)
    if (previous[key].some((old) => !state[key].some((item) => item.id === old.id)))
      throw new AppError(
        422,
        'HISTORY_REQUIRED',
        'ไม่สามารถลบรอบสอบหรือเอกสารเดิม ให้แก้สถานะและระบุหมายเหตุ',
      );
  state.modules = state.modules.map((m) => ({
    ...m,
    name: previous.modules.find((p) => p.id === m.id)?.name || m.name,
  }));
  const keys = ['notice', 'training', 'exams', 'documents', 'issue', 'modules'] as const;
  const changed = keys
    .filter((key) => canonical(state[key]) !== canonical(previous[key]))
    .map(
      (key) =>
        ({
          notice: 'แจ้งวันอบรม',
          training: 'จองอบรม',
          exams: 'รอบสอบ/ผลสอบ',
          documents: 'เอกสาร',
          issue: 'รหัสตัวแทน',
          modules: 'Module อบรม',
        })[key],
    );
  if (state.documentsConfirmed !== previous.documentsConfirmed) changed.push('ยืนยันเอกสารครบ');
  await save(
    db,
    config,
    'task:' + id,
    input.version,
    state,
    user,
    operationKey,
    'บันทึก: ' + (changed.join(', ') || 'เริ่มติดตาม Workflow'),
  );
  return { id };
}
export async function saveTemplate(
  db: Sql,
  config: Environment,
  user: User,
  input: z.infer<typeof templateInput>,
  operationKey: string,
) {
  if (user.role !== 'Admin') throw forbidden();
  if (
    (
      await db.query(
        'SELECT version FROM hvr_workflow_history WHERE environment=$1 AND operation_key=$2 AND resource=$3',
        [config.APP_ENV, operationKey, 'template'],
      )
    ).rows.length
  )
    return { id: 'template' };
  const current = await readTemplate(db, config);
  if (current.version !== input.version) throw conflict();
  const template = templateSchema.parse(input.template);
  if (current.template.modules.some((m) => !template.modules.some((n) => n.id === m.id)))
    throw new AppError(422, 'MODULE_HISTORY', 'เปลี่ยนชื่อหรือเพิ่ม Module ได้ แต่ไม่ลบ Module ที่มีประวัติ');
  await save(
    db,
    config,
    'template',
    input.version,
    template,
    user,
    operationKey,
    'แก้รายการมาตรฐาน Workflow ตัวแทนใหม่',
  );
  return { id: 'template' };
}
export async function requireWorkflowComplete(
  db: Sql,
  config: Environment,
  repo: AirtableRepository,
  user: User,
  id: string,
) {
  const task = await ownTask(repo, user, id);
  if (task.category !== onboardingCategory) return;
  const view = await readWorkflow(db, config, id, false);
  if (!view.summary.complete)
    throw new AppError(
      409,
      'WORKFLOW_INCOMPLETE',
      'ยังปิดงานไม่ได้: ' + stageNames.filter((_, i) => !view.summary.stages[i]).join(', '),
    );
}
export async function attachWorkflowSummaries(db: Sql, config: Environment, tasks: TaskSummary[]) {
  const ids = tasks.filter((t) => t.category === onboardingCategory).map((t) => 'task:' + t.id);
  if (!ids.length) return tasks;
  const template = await readTemplate(db, config);
  const rows = (
    await db.query(
      'SELECT resource,payload FROM hvr_workflows WHERE environment=$1 AND resource=ANY($2::text[])',
      [config.APP_ENV, ids],
    )
  ).rows;
  return tasks.map((t) => {
    if (t.category !== onboardingCategory) return t;
    const row = rows.find((r) => r.resource === 'task:' + t.id);
    const summary = workflowSummary(
      labels(
        row ? workflowSchema.parse(row.payload) : newWorkflow(template.template),
        template.template,
      ),
    );
    return {
      ...t,
      followupDate: [t.followupDate, summary.nextDate].filter(Boolean).sort()[0] || '',
      workflowSummary:
        `อบรม ${summary.modulesDone}/${summary.modulesTotal} Module` +
        (summary.nextLabel ? ' · ' + summary.nextLabel : ''),
    };
  });
}
