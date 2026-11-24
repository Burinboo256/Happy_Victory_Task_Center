import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from 'pg';
import type { Config } from './config';

export interface Sql {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}
export interface TransactionalSql extends Sql {
  transaction<T>(work: (db: Sql) => Promise<T>): Promise<T>;
}

// Production uses a checked-out connection; isolated test engines supply their own transaction.
export async function atomic<T>(db: Sql, work: (connection: Sql) => Promise<T>): Promise<T> {
  if ('transaction' in db && typeof db.transaction === 'function')
    return (db as TransactionalSql).transaction(work);
  if (!('connect' in db) || typeof db.connect !== 'function')
    throw new Error('A transactional database is required');
  return transaction(db as Pool, work);
}
// HTTP integrations can run while all application connections are checked out.
// Their short, autocommit rate-limit queries must not wait for those transactions
// (or retain a rate-limit row lock across an external HTTP request).
export class ApplicationPool extends Pool {
  readonly rateLimits: Pool;
  constructor(options: PoolConfig) {
    super(options);
    this.rateLimits = new Pool({ ...options, max: 2 });
    this.on('error', () => console.error('database_pool_error'));
    this.rateLimits.on('error', () => console.error('database_rate_limit_pool_error'));
  }
  end(): Promise<void>;
  end(callback: () => void): void;
  end(callback?: () => void): Promise<void> | void {
    const closing = Promise.all([super.end(), this.rateLimits.end()]).then(() => undefined);
    if (callback) {
      void closing.then(callback);
      return;
    }
    return closing;
  }
}
export const rateLimitDatabase = (db: Sql): Sql =>
  db instanceof ApplicationPool ? db.rateLimits : db;

const pools = new Map<string, ApplicationPool>();
export function getPool(config: Pick<Config, 'DATABASE_URL'>) {
  let pool = pools.get(config.DATABASE_URL);
  if (!pool) {
    pool = new ApplicationPool({
      connectionString: config.DATABASE_URL,
      max: 3,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      allowExitOnIdle: true,
    });
    pools.set(config.DATABASE_URL, pool);
  }
  return pool;
}
export async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
