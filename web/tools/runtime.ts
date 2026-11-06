import { parseArgs } from 'node:util';
import { localConfig } from './environment';
import { getPool } from '../src/server/db';
import { verifyInstance } from '../src/server/runtime';

const config = localConfig(),
  db = getPool(config);
try {
  const { values } = parseArgs({
    options: {
      environment: { type: 'string' },
      'base-id': { type: 'string' },
      writes: { type: 'string' },
    },
  });
  if (
    values.environment !== config.APP_ENV ||
    values['base-id'] !== config.AIRTABLE_BASE_ID ||
    !['on', 'off'].includes(values.writes || '')
  )
    throw new Error('Specify the configured environment, base ID, and --writes=on|off');
  if (values.writes === 'on' && !config.TASK_WRITES_ENABLED)
    throw new Error(
      'TASK_WRITES_ENABLED must allow writes before the runtime switch can enable them',
    );
  await verifyInstance(db, config);
  const result = await db.query(
    'UPDATE hvr_runtime SET task_writes=$2 WHERE environment=$1 RETURNING task_writes',
    [config.APP_ENV, values.writes === 'on'],
  );
  if (result.rows.length !== 1) throw new Error('Missing runtime configuration');
  console.log(
    JSON.stringify({ environment: config.APP_ENV, taskWrites: result.rows[0].task_writes }),
  );
} catch {
  console.error(
    'Runtime switch was not confirmed. Verify the environment, base ID, flags and database access.',
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
