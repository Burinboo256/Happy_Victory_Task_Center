import type { QueryResultRow } from 'pg';
import { atomic, type Sql, type TransactionalSql } from '../db';
import { operationalMigrations } from './schema-bundle';

export async function createOperationalSchema(
  db: Sql,
  schema: string,
  environment: string,
  baseId: string,
) {
  if (!/^hvr_ws_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid new workspace schema');
  await db.query(`CREATE SCHEMA "${schema}"`);
  await db.query("SELECT set_config('search_path',$1,true)", [schema]);
  await db.query(
    'CREATE TABLE hvr_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const migration of operationalMigrations) {
    for (const statement of migration.statements) await db.query(statement);
    await db.query('INSERT INTO hvr_migrations(name,checksum) VALUES($1,$2)', [
      migration.name,
      migration.checksum,
    ]);
  }
  await db.query('INSERT INTO hvr_instances(environment,base_id) VALUES($1,$2)', [
    environment,
    baseId,
  ]);
  await db.query('INSERT INTO hvr_runtime(environment,task_writes) VALUES($1,true)', [environment]);
}

export function workspaceDatabase(root: Sql, schema: string): TransactionalSql {
  if (schema !== 'public' && !/^hvr_ws_[a-f0-9]{32}$/.test(schema))
    throw new Error('Invalid workspace schema');
  const transaction = <T>(work: (db: Sql) => Promise<T>) =>
    atomic(root, async (db) => {
      // No public fallback: missing workspace tables must fail, never read the legacy space.
      await db.query("SELECT set_config('search_path',$1,true)", [schema]);
      return work(db);
    });
  return {
    transaction,
    query<R extends QueryResultRow>(sql: string, values?: unknown[]) {
      return transaction((db) => db.query<R>(sql, values));
    },
  };
}
