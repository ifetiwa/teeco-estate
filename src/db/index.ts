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
    const hooks: Array<() => Promise<void>> = []
    const result = await getDb().transaction(async (tx) => {
        afterCommitHooks.set(tx, hooks)
        await tx.execute(sql`select
            set_config('app.estate_id', ${ctx.estateId ?? ''}, true),
            set_config('app.user_id', ${ctx.userId ?? ''}, true),
            set_config('app.system', ${ctx.system ? 'on' : ''}, true)`)
        return fn(tx)
    })
    // Side effects (push notifications) only once the change is saved; their failures never undo it
    for (const hook of hooks) await hook().catch((e: unknown) => console.error('[after-commit]', e))
    return result
}

const afterCommitHooks = new WeakMap<Queryable, Array<() => Promise<void>>>()

/**
 * Runs fn after the withDbContext transaction that `tx` belongs to has committed (never if it rolls back).
 * Outside such a transaction, fn runs straight away.
 */
export function afterCommit (tx: Queryable, fn: () => Promise<void>): void {
    const hooks = afterCommitHooks.get(tx)
    if (hooks) hooks.push(fn)
    else void fn().catch((e: unknown) => console.error('[after-commit]', e))
}

/**
 * Awaits lazy query builders one after another. A transaction uses a single connection, so running its
 * queries "in parallel" with Promise.all gains nothing and is deprecated by node-postgres.
 */
export async function inOrder<const T extends readonly unknown[]> (items: T): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
    const out: unknown[] = []
    for (const item of items) out.push(await item)
    return out as { -readonly [K in keyof T]: Awaited<T[K]> }
}
