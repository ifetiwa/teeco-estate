import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import * as schema from './schema'

export type DB = NodePgDatabase<typeof schema>

const globalForDb = globalThis as unknown as { teecoPool?: Pool, teecoDb?: DB }

function createPool (): Pool {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    return new Pool({ connectionString: url, max: 10 })
}

export function getPool (): Pool {
    if (!globalForDb.teecoPool) globalForDb.teecoPool = createPool()
    return globalForDb.teecoPool
}

export function getDb (): DB {
    if (!globalForDb.teecoDb) globalForDb.teecoDb = drizzle(getPool(), { schema })
    return globalForDb.teecoDb
}

export async function closeDb (): Promise<void> {
    if (globalForDb.teecoPool) await globalForDb.teecoPool.end()
    globalForDb.teecoPool = undefined
    globalForDb.teecoDb = undefined
}
