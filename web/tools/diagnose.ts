import { localConfig } from './environment';
import { getPool } from '../src/server/db';
import { verifyInstance } from '../src/server/runtime';
import { AirtableClient, type Table } from '../src/server/airtable/client';
import { inspectSchema } from '../src/server/airtable/schema';
import { AppError } from '../src/server/errors';

const config = localConfig(),
  db = getPool(config);
try {
  await verifyInstance(db, config);
  const repo = new AirtableClient(config, db);
  const token = process.env.AIRTABLE_SCHEMA_TOKEN || '';
  const issues = inspectSchema(await repo.schema(token), config);
  if (issues.length) {
    // Only known contract names and categorical codes; no upstream values or formula bodies.
    console.error(JSON.stringify({ schemaIssues: issues }, null, 2));
    throw new AppError(503, 'SCHEMA_MISMATCH', 'Schema contract failed.');
  }
  console.log('Schema contract: passed');
  for (const table of ['users', 'tasks', 'updates', 'followups', 'notifications'] as Table[]) {
    // Read-only diagnostics; record bodies and credentials are never printed.
    await repo.list(table, 'FALSE()');
    console.log(table + ': readable');
  }
  console.log(
    'Schema and table access passed for ' +
      config.APP_ENV +
      '; live login and data acceptance remain separate.',
  );
} catch (error) {
  console.error(error instanceof AppError ? error.code : 'DIAGNOSTIC_FAILED');
  process.exitCode = 1;
} finally {
  await db.end();
}
