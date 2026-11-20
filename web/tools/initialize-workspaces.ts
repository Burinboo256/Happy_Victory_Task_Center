import { parseArgs } from 'node:util';
import { localConfig } from './environment';
import { getPool } from '../src/server/db';
import { AirtableClient } from '../src/server/airtable/client';
import { verifyInstance } from '../src/server/runtime';
import { ControlPlane } from '../src/server/workspaces/control';
import { initializeSpaces } from '../src/server/workspaces/bootstrap';
const config = localConfig(),
  db = getPool(config);
try {
  const { values } = parseArgs({
    options: {
      'owner-email': { type: 'string' },
      'confirm-base': { type: 'string' },
      apply: { type: 'boolean' },
    },
  });
  if (values['confirm-base'] !== config.AIRTABLE_BASE_ID || !values['owner-email'])
    throw new Error('Confirm environment and owner');
  await verifyInstance(db, config);
  if (!values.apply)
    console.log(
      JSON.stringify({
        mode: 'dry-run',
        environment: config.APP_ENV,
        baseId: config.AIRTABLE_BASE_ID,
        action: 'Create RINLYN mapping; preserve existing data',
      }),
    );
  else
    console.log(
      await initializeSpaces(
        db,
        config,
        new ControlPlane(config, db),
        new AirtableClient(config, db),
        values['owner-email'],
      ),
    );
} catch {
  console.error(
    'Workspace initialization was not confirmed. Check backup, Control Base fields, owner, Base and partial setup before retrying.',
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
