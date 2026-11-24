import type { AirtableRepository } from '../airtable/client';
import type { Sql } from '../db';
import type { Config } from '../config';
import { isManager, type User } from '../../domain/model';
import { onboardingCategory } from '../../domain/onboarding';
import { detail } from './reads';
import { readWorkflow } from './onboarding';
import { readCaseWorkflow } from './case-workflow';

export async function taskDetail(
  c: { repo: AirtableRepository; db: Sql; config: Config; user: User },
  id: string,
) {
  const result = await detail(c.repo, c.user, id);
  const legacy =
    result.task.category === onboardingCategory &&
    (
      await c.db.query('SELECT 1 FROM hvr_workflows WHERE environment=$1 AND resource=$2', [
        c.config.APP_ENV,
        'task:' + result.task.id,
      ])
    ).rows.length > 0;
  const workflow = legacy
    ? await readWorkflow(c.db, c.config, result.task.id, isManager(c.user))
    : undefined;
  const caseWorkflow = await readCaseWorkflow(c.db, c.config, result.task, isManager(c.user));
  if (caseWorkflow && isManager(c.user))
    result.task.followupDate =
      [result.task.followupDate, caseWorkflow.summary.nextDate].filter(Boolean).sort()[0] || '';
  return { ...result, workflow, caseWorkflow };
}
