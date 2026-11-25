import type { Sql } from '../db';
import type { Config } from '../config';
import type { AirtableRepository } from '../airtable/client';
import { AppError, forbidden } from '../errors';
import { isManager, type User } from '../../domain/model';
import { taskOperation } from '../task-store/operation';
import { mutate, type CreateTaskInput } from './mutations';

type Context = { db: Sql; config: Config; user: User; repo: AirtableRepository };
type CreateInput = CreateTaskInput & { careEventId: string };

export async function createCareTask(c: Context, input: CreateInput, requestId: string) {
  const event = (
    await c.db.query(
      `SELECT e.id,p.closed,e.outcome,to_regclass('hvr_one_task_per_care_event') IS NOT NULL AS link_ready
       FROM hvr_care_events e JOIN hvr_care_policies p ON p.id=e.policy_id
     WHERE e.id=$1 AND p.environment=$2 AND ($3 OR p.agent_id=$4)`,
      [input.careEventId, c.config.APP_ENV, isManager(c.user), c.user.id],
    )
  ).rows[0];
  if (!event) throw forbidden();
  if (!event.link_ready)
    throw new AppError(503, 'CARE_LINK_UNAVAILABLE', 'Space นี้ยังไม่พร้อมสำหรับการเปิดงานจากนัด');
  const resource = `care-event:${event.id}`;

  const receipt = async () =>
    (
      await c.db.query(
        `SELECT id,state,result,user_id,request_id,payload FROM hvr_operations
     WHERE environment=$1 AND resource=$2 AND resource LIKE 'care-event:%' AND action='create' AND state<>'failed'`,
        [c.config.APP_ENV, resource],
      )
    ).rows[0];

  const existing = await receipt();
  if (existing?.state === 'completed' || (existing && existing.user_id !== c.user.id))
    return { operationId: existing.id, state: existing.state, result: existing.result };
  if (!existing && (event.closed || event.outcome))
    throw new AppError(409, 'CARE_CLOSED', 'นัดนี้สิ้นสุดการติดตามแล้ว');

  // A retry resumes the first accepted form, even if a tab was closed or its fields changed.
  const payload = existing?.payload ?? input;
  try {
    return await taskOperation(
      c.db,
      c.config,
      c.repo,
      c.user.id,
      existing?.request_id ?? requestId,
      'create',
      payload,
      resource,
      (steps, repo) => mutate(repo, c.user, 'create', payload, steps),
    );
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        'constraint' in error &&
        error.constraint === 'hvr_one_task_per_care_event'
      )
    )
      throw error;
    const winner = await receipt();
    if (!winner) throw new AppError(409, 'CARE_RETRY', 'กรุณาลองส่งงานจากนัดนี้อีกครั้ง');
    return { operationId: winner.id, state: winner.state, result: winner.result };
  }
}
