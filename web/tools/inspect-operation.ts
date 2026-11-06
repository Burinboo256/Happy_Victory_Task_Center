import { parseArgs } from 'node:util';
import { z } from 'zod';
import { localConfig } from './environment';
import { getPool } from '../src/server/db';
import { verifyInstance } from '../src/server/runtime';

const config = localConfig(),
  db = getPool(config);
try {
  const { values } = parseArgs({
    options: { id: { type: 'string' }, environment: { type: 'string' } },
  });
  const id = z.uuid().parse(values.id);
  if (values.environment !== config.APP_ENV) throw new Error('Environment mismatch');
  await verifyInstance(db, config);
  const result = await db.query(
    'SELECT id,action,state,steps,error_code,updated_at FROM hvr_operations WHERE environment=$1 AND id=$2',
    [config.APP_ENV, id],
  );
  if (result.rows.length !== 1) throw new Error('Operation not found');
  const row = result.rows[0];
  // No payload, identity, customer details or step values are printed.
  console.log(
    JSON.stringify(
      {
        id: row.id,
        action: row.action,
        state: row.state,
        errorCode: row.error_code,
        updatedAt: row.updated_at,
        steps: Object.entries(
          row.steps as Record<string, { state: string; write: boolean; intent?: unknown }>,
        ).map(([name, step]) => ({
          name,
          state: step.state,
          write: step.write,
          hasIntent: !!step.intent,
        })),
      },
      null,
      2,
    ),
  );
} catch {
  console.error('Cannot inspect this operation. Verify the ID, environment and database access.');
  process.exitCode = 1;
} finally {
  await db.end();
}
