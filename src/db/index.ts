import { sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import * as schema from './schema'

export type DB = NodePgDatabase<typeof schema>
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0]
/** Anything that can run queries: the pool-backed DB or a transaction. */
export type Queryable = DB | Tx

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

/**
 * Raw database handle. Estate-owned tables are protected by row-level security, so queries on them
 * return nothing unless run inside withDbContext(). Use it for global tables (users, sessions, otp_codes).
 */
export function getDb (): DB {
    if (!globalForDb.teecoDb) globalForDb.teecoDb = drizzle(getPool(), { schema })
    return globalForDb.teecoDb
}

export async function closeDb (): Promise<void> {
    if (globalForDb.teecoPool) await globalForDb.teecoPool.end()
    globalForDb.teecoPool = undefined
    globalForDb.teecoDb = undefined
}

export interface DbContext {
    /** Rows of this estate become visible (RLS: app.estate_id) */
    estateId?: string
    /** The user's own memberships/occupancies become visible across estates (RLS: app.user_id) */
    userId?: string
    /** System operations only (estate creation, join-code lookup, platform counts). Never for user-driven reads of estate data. */
    system?: boolean
}

/**
 * Runs fn in a transaction whose row-level-security context is set from ctx.
 * Settings are transaction-local, so pooled connections never leak context between requests.
 */
export async function withDbContext<T> (ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return getDb().transaction(async (tx) => {
        await tx.execute(sql`select
            set_config('app.estate_id', ${ctx.estateId ?? ''}, true),
            set_config('app.user_id', ${ctx.userId ?? ''}, true),
            set_config('app.system', ${ctx.system ? 'on' : ''}, true)`)
        return fn(tx)
    })
}
