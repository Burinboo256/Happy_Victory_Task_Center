import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { formulaValue, type AirtableRepository, type RecordData } from '../airtable/client';
import type { Config } from '../config';
import type { Sql } from '../db';
import { AppError } from '../errors';
import { verifyInstance } from '../runtime';
import type { StoredStep, WriteIntent } from './intent';
import { canonical } from './journal';

const request = z.object({
  id: z.uuid(),
  action: z.enum(['mark-stopped', 'reconcile']),
  confirmNoInflight: z.uuid(),
  operator: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  evidence: z.string().regex(/^[a-zA-Z0-9_/-]{1,120}$/),
});
export type RecoveryRequest = z.infer<typeof request>;
type Operation = {
  id: string;
  action: string;
  state: string;
  payload: Record<string, unknown>;
  steps: Record<string, StoredStep>;
  revision: string;
  age: string;
};

function sameField(name: string, actual: unknown, expected: unknown) {
  const blank = (v: unknown) =>
    v === undefined ||
    v === null ||
    v === '' ||
    v === false ||
    (Array.isArray(v) && v.length === 0);
  if (blank(actual) && blank(expected)) return true;
  if (name === 'Completed At' && typeof actual === 'string' && typeof expected === 'string') {
    const time = Date.parse(expected);
    return Number.isFinite(time) && Date.parse(actual) === time;
  }
  return canonical(actual) === canonical(expected);
}
function matches(record: RecordData, intent: WriteIntent) {
  return Object.entries(intent.fields).every(([field, expected]) =>
    sameField(field, record.fields[field], expected),
  );
}
// Only business steps emitted by this application may be reconciled. Never infer an old intent.
function inScope(op: Operation, name: string, intent: WriteIntent) {
  const key = 'web:' + op.id;
  if (intent.kind === 'upsert') {
    const allowed =
      name === 'task' && op.action === 'create'
        ? ['tasks', 'Request Key', key]
        : name === 'audit' &&
            ['create', 'comment', 'status', 'followup', 'resolveFollowup'].includes(op.action)
          ? ['updates', 'Operation Key', key + ':audit']
          : name === 'followup' && op.action === 'followup'
            ? ['followups', 'Operation Key', key]
            : name === 'notification' && op.action === 'status'
              ? ['notifications', 'Operation Key', key + ':notification']
              : null;
    if (
      !allowed ||
      intent.table !== allowed[0] ||
      intent.keyField !== allowed[1] ||
      intent.fields[intent.keyField] !== allowed[2]
    )
      return false;
    if (intent.table !== 'tasks') {
      const taskId = op.action === 'create' ? op.steps.task?.value : op.payload.id;
      if (canonical(intent.fields.Task) !== canonical([taskId])) return false;
    }
    return true;
  }
  if (intent.kind !== 'patch') return false;
  if (name === 'patch' && op.action === 'status')
    return (
      intent.table === 'tasks' &&
      intent.recordId === op.payload.id &&
      canonical(Object.keys(intent.fields).sort()) === canonical(['Completed At', 'Status']) &&
      intent.fields.Status === op.payload.status
    );
  if (name === 'resolve' && op.action === 'resolveFollowup')
    return (
      intent.table === 'followups' &&
      intent.recordId === op.payload.followupId &&
      canonical(Object.keys(intent.fields).sort()) ===
        canonical(['Completed At', 'Follow-up Status', 'Result / Notes']) &&
      intent.fields['Follow-up Status'] === op.payload.status &&
      intent.fields['Result / Notes'] === op.payload.notes
    );
  return (
    name === 'next' &&
    ['followup', 'resolveFollowup'].includes(op.action) &&
    intent.table === 'tasks' &&
    intent.recordId === op.payload.id &&
    canonical(Object.keys(intent.fields)) === canonical(['Next Follow-up'])
  );
}

export class OperationRecovery {
  constructor(
    private db: Sql,
    private config: Config,
    private repo: AirtableRepository,
  ) {}

  async run(input: unknown) {
    const data = request.parse(input);
    if (data.confirmNoInflight !== data.id)
      throw new AppError(409, 'RECOVERY_CONFIRMATION', 'Confirm that this invocation has stopped.');
    await verifyInstance(this.db, this.config);
    const paused = await this.db.query(
      'SELECT task_writes,jobs FROM hvr_runtime WHERE environment=$1',
      [this.config.APP_ENV],
    );
    if (paused.rows[0]?.task_writes !== false || paused.rows[0]?.jobs !== false)
      throw new AppError(409, 'RECOVERY_REQUIRES_PAUSE', 'Pause writes and jobs before recovery.');
    const found = await this.db.query(
      `SELECT id,action,state,payload,steps,updated_at::text AS revision,
       EXTRACT(EPOCH FROM (clock_timestamp()-updated_at)) AS age
       FROM hvr_operations WHERE environment=$1 AND id=$2`,
      [this.config.APP_ENV, data.id],
    );
    const op = found.rows[0] as Operation | undefined;
    if (!op) throw new AppError(404, 'OPERATION_NOT_FOUND', 'Operation not found.');
    const confirmed: string[] = [],
      unresolved: string[] = [];
    let state: 'review' | 'pending' = 'review';
    if (data.action === 'mark-stopped') {
      if (op.state !== 'running' || Number(op.age) < 120)
        throw new AppError(
          409,
          'RECOVERY_NOT_STOPPED',
          'Only a stopped running invocation older than 120 seconds may be marked for review.',
        );
    } else {
      if (op.state !== 'review')
        throw new AppError(409, 'RECOVERY_NOT_REVIEW', 'Only review operations may be reconciled.');
      for (const [name, step] of Object.entries(op.steps)) {
        if (step.state !== 'started') continue;
        if (!step.write) {
          delete op.steps[name];
          continue;
        }
        const intent = step.intent;
        if (!intent || !inScope(op, name, intent)) {
          unresolved.push(name);
          continue;
        }
        let record: RecordData | undefined;
        if (intent.kind === 'upsert') {
          const key = intent.fields[intent.keyField];
          const records = (
            await this.repo.list(intent.table, `{${intent.keyField}}=${formulaValue(String(key))}`)
          ).filter((r) => r.fields[intent.keyField] === key);
          if (records.length === 1) record = records[0];
        } else {
          try {
            record = await this.repo.get(intent.table, intent.recordId);
          } catch (error) {
            if (!(error instanceof AppError) || error.status !== 404) throw error;
          }
        }
        if (!record || !matches(record, intent)) {
          unresolved.push(name);
          continue;
        }
        if (
          intent.kind === 'patch' &&
          intent.table === 'followups' &&
          canonical(record.fields.Task) !== canonical([op.payload.id])
        ) {
          unresolved.push(name);
          continue;
        }
        if (name === 'next') {
          const pending = (
            await this.repo.list(
              'followups',
              `AND({Task Record ID}=${formulaValue(String(op.payload.id))},{Follow-up Status}="Pending")`,
            )
          )
            .filter(
              (r) =>
                canonical(r.fields.Task) === canonical([op.payload.id]) &&
                r.fields['Follow-up Status'] === 'Pending' &&
                typeof r.fields['Follow-up Date'] === 'string',
            )
            .map((r) => String(r.fields['Follow-up Date']).slice(0, 10))
            .sort();
          if (!sameField('Next Follow-up', intent.fields['Next Follow-up'], pending[0] || null)) {
            unresolved.push(name);
            continue;
          }
        }
        step.state = 'completed';
        step.value = intent.kind === 'upsert' ? record.id : true;
        confirmed.push(name);
      }
      state = unresolved.length ? 'review' : 'pending';
    }
    // CAS preserves microsecond precision and atomically records the operator's evidence.
    // Reservations remain held until the original user's normal retry completes.
    const changed = await this.db.query(
      `WITH changed AS (
        UPDATE hvr_operations SET state=$5,steps=$6,error_code=$7,retry_at=NULL,updated_at=clock_timestamp()
        WHERE environment=$1 AND id=$2 AND state=$3 AND updated_at=$4::timestamptz
          AND EXISTS(SELECT 1 FROM hvr_runtime WHERE environment=$1 AND NOT task_writes AND NOT jobs)
        RETURNING id
      ) INSERT INTO hvr_recovery_events(event_id,environment,operation_id,action,operator_label,evidence_ref,confirmed_steps,from_state,to_state)
        SELECT $8,$1,id,$9,$10,$11,$12,$3,$5 FROM changed RETURNING event_id`,
      [
        this.config.APP_ENV,
        op.id,
        op.state,
        op.revision,
        state,
        JSON.stringify(op.steps),
        state === 'pending' ? null : 'RECOVERY_REVIEW',
        randomUUID(),
        data.action,
        data.operator,
        data.evidence,
        JSON.stringify(confirmed),
      ],
    );
    if (changed.rows.length !== 1)
      throw new AppError(
        409,
        'RECOVERY_CONFLICT',
        'Operation or maintenance state changed. Inspect again.',
      );
    return { operationId: op.id, state, confirmed, unresolved };
  }
}
