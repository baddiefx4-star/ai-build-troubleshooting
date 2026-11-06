import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL is not configured.')
}

const globalForDb = globalThis as typeof globalThis & { ctechPgPool?: Pool }
export const pool = globalForDb.ctechPgPool ?? new Pool({ connectionString, max: 5, idleTimeoutMillis: 10_000 })
globalForDb.ctechPgPool = pool

export const db = drizzle(pool, { schema })
