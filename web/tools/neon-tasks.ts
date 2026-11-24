import { parseArgs } from 'node:util';
import { localConfig } from './environment';
import { getPool } from '../src/server/db';
import { ControlPlane } from '../src/server/workspaces/control';
import { modeGuard, spaceServices } from '../src/server/workspaces/service';
import { importTasks, activateTasks } from '../src/server/task-store/import';
import { drainTaskMirror, taskSyncStatus, reviewTaskMirror } from '../src/server/task-store/sync';
import { businessTables } from '../src/server/task-store/repository';
import { AppError } from '../src/server/errors';

const c = localConfig(),
  db = getPool(c);
try {
  const { values } = parseArgs({
    options: {
      action: { type: 'string' },
      space: { type: 'string' },
      'base-id': { type: 'string' },
      environment: { type: 'string' },
      kind: { type: 'string' },
      id: { type: 'string' },
      version: { type: 'string' },
      evidence: { type: 'string' },
      'confirmed-stopped': { type: 'boolean' },
    },
  });
  if (
    c.APP_ENV === 'production' ||
    values.environment !== c.APP_ENV ||
    !values.space ||
    !values['base-id']
  )
    throw new Error(
      'This rehearsal CLI permits only explicit development/staging targets; production needs a reviewed cutover runbook.',
    );
  await modeGuard(db, c);
  const control = new ControlPlane(c, db);
  const s = await spaceServices(db, c, control, values.space);
  if (values['base-id'] !== s.config.AIRTABLE_BASE_ID) throw new Error('Base mismatch');
  let result: unknown;
  switch (values.action) {
    case 'status':
      result = {
        mode:
          (await s.db.query('SELECT mode FROM hvr_task_storage WHERE environment=$1', [c.APP_ENV]))
            .rows[0]?.mode || 'airtable',
        ...(await taskSyncStatus(s.db, s.config)),
      };
      break;
    case 'freeze':
    case 'resume':
      await s.db.query('UPDATE hvr_runtime SET task_writes=$2 WHERE environment=$1', [
        c.APP_ENV,
        values.action === 'resume',
      ]);
      result = { writes: values.action === 'resume' };
      break;
    case 'import':
      result = await importTasks(s.db, s.config, s.rawRepo);
      break;
    case 'activate':
      result = await activateTasks(s.db, s.config, s.rawRepo);
      break;
    case 'drain':
      result = await drainTaskMirror(s.db, s.config, s.rawRepo);
      break;
    case 'inspect':
      result = (
        await s.db.query(
          "SELECT kind,record_id,version,state,attempts,error_code,next_attempt_at FROM hvr_airtable_outbox WHERE environment=$1 AND state<>'synced' ORDER BY next_attempt_at LIMIT 100",
          [c.APP_ENV],
        )
      ).rows;
      break;
    case 'review': {
      const kind = businessTables.find((t) => t === values.kind);
      const version = Number(values.version);
      if (!kind || !values.id || !Number.isSafeInteger(version) || version < 1)
        throw new Error('Invalid review target');
      result = await reviewTaskMirror(
        s.db,
        s.config,
        s.rawRepo,
        kind,
        values.id,
        version,
        values.evidence || '',
        values['confirmed-stopped'] === true,
      );
      break;
    }
    default:
      throw new Error('Use --action=status|freeze|import|activate|resume|drain');
  }
  console.log(
    JSON.stringify({ environment: c.APP_ENV, space: values.space, ...(result as object) }),
  );
} catch (error) {
  console.error(error instanceof AppError ? error.code : 'NEON_TASK_COMMAND_FAILED');
  process.exitCode = 1;
} finally {
  await db.end();
}
