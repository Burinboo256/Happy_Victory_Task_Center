import { localEnvironment } from './environment';
import { readConfig } from '../src/server/config';
import { getPool } from '../src/server/db';
import { verifyInstance } from '../src/server/runtime';
import { AirtableClient, formulaValue } from '../src/server/airtable/client';
import { userDto } from '../src/server/airtable/dto';
import { catalogueRows, importCatalogue } from '../src/server/documents/import';

const args = process.argv.slice(2);
let db: ReturnType<typeof getPool> | undefined;
try {
  const rows = catalogueRows();
  if (!args.includes('--apply')) {
    console.log(
      JSON.stringify({
        mode: 'dry-run',
        count: rows.length,
        pendingLinkReview: rows.filter((r) => r.needsLinkReview).map((r) => r.key),
        publication: 'all drafts',
      }),
    );
  } else {
    const email = args.find((a) => a.startsWith('--admin-email='))?.slice('--admin-email='.length);
    if (!email) throw new Error('Admin email required');
    const c = readConfig(localEnvironment());
    db = getPool(c);
    await verifyInstance(db, c);
    const repo = new AirtableClient(c, db);
    const users = await repo.list('users', `{Email}=${formulaValue(email)}`);
    if (users.length !== 1) throw new Error('Admin lookup is not unique');
    const result = await importCatalogue(db, c, userDto(users[0]));
    console.log(
      JSON.stringify({
        environment: c.APP_ENV,
        created: result.created.length,
        skipped: result.skipped,
        publication: 'all drafts',
      }),
    );
  }
} catch {
  console.error(
    'Document import failed. Verify configuration, active Admin identity and database migrations; no credentials are printed.',
  );
  process.exitCode = 1;
} finally {
  await db?.end();
}
