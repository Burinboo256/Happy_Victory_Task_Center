import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import type { Config } from './config';

export interface Sql {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}
const pools = new Map<string, Pool>();
export function getPool(config: Pick<Config, 'DATABASE_URL'>) {
  let pool = pools.get(config.DATABASE_URL);
  if (!pool) {
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: 3,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      allowExitOnIdle: true,
    });
    // Pool errors must never log a connection string or SQL payload.
    pool.on('error', () => console.error('database_pool_error'));
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
