import { env, logger } from '@gaian-stellar-integration/config';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import * as schema from './schema/index.js';

export type AppDb = NodePgDatabase<typeof schema>;

let _pool: Pool | undefined;
let _db: AppDb | undefined;

const poolConfig = (): PoolConfig => ({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: env.DATABASE_POOL_IDLE_MS,
  connectionTimeoutMillis: env.DATABASE_CONNECTION_TIMEOUT_MS,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
});

export const getPool = (): Pool => {
  if (_pool) return _pool;
  _pool = new Pool(poolConfig());
  // Every new pool connection gets config + integration on its search_path
  // so raw SQL written without explicit schema qualifiers still resolves.
  // `public` stays first so shared gaian-services tables resolve unchanged.
  _pool.on('connect', (client) => {
    client.query('SET search_path TO public, config, integration').catch((err: unknown) => {
      logger.error({ err }, 'search_path set failed');
    });
  });
  // pg emits 'error' on the pool when an IDLE client dies (network blip, backend
  // restart, ephemeral-port exhaustion — e.g. EADDRNOTAVAIL). Without a listener
  // Node treats it as an unhandled 'error' event and crashes the whole process.
  // The pool already removes the broken client; log and swallow so a transient
  // connection fault can't take the service down.
  _pool.on('error', (err) => {
    logger.error({ err }, 'pg idle client error (non-fatal, client evicted)');
  });
  return _pool;
};

export const getDb = (): AppDb => {
  _db ??= drizzle(getPool(), { schema });
  return _db;
};

export const closeDb = async (): Promise<void> => {
  if (_pool) {
    await _pool.end();
    _pool = undefined;
    _db = undefined;
  }
};
