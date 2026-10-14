import 'dotenv/config'

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

import { ensureAppRole } from './db-roles'

/** Applies migrations as the owner, then (re)grants the restricted application role. */
export async function runMigrations (ownerUrl: string, appUrl?: string): Promise<void> {
    const pool = new Pool({ connectionString: ownerUrl, max: 1 })
    try {
        await migrate(drizzle(pool), { migrationsFolder: 'drizzle' })
    } finally {
        await pool.end()
    }
    if (appUrl) await ensureAppRole(ownerUrl, appUrl)
}

if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
    const ownerUrl = process.env.DATABASE_OWNER_URL
    const appUrl = process.env.DATABASE_URL
    if (!ownerUrl || !appUrl) throw new Error('DATABASE_OWNER_URL and DATABASE_URL must be set')
    runMigrations(ownerUrl, appUrl).then(() => console.log('migrations applied'), (e) => {
        console.error(e)
        process.exit(1)
    })
}
