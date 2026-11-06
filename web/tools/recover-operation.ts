import { parseArgs } from 'node:util';
import { localConfig } from './environment';
import { getPool } from '../src/server/db';
import { AirtableClient } from '../src/server/airtable/client';
import { OperationRecovery } from '../src/server/operations/recovery';
import { AppError } from '../src/server/errors';

const config = localConfig(),
  db = getPool(config);
try {
  const { values } = parseArgs({
    options: {
      id: { type: 'string' },
      environment: { type: 'string' },
      action: { type: 'string' },
      operator: { type: 'string' },
      evidence: { type: 'string' },
      'confirm-no-inflight': { type: 'string' },
    },
  });
  if (values.environment !== config.APP_ENV) throw new Error('Environment mismatch');
  const result = await new OperationRecovery(db, config, new AirtableClient(config, db)).run({
    id: values.id,
    action: values.action,
    operator: values.operator,
    evidence: values.evidence,
    confirmNoInflight: values['confirm-no-inflight'],
  });
  // Print state and step names only; never credentials, payloads or customer data.
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof AppError ? error.code : 'RECOVERY_FAILED');
  process.exitCode = 1;
} finally {
  await db.end();
}
