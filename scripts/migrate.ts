import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

export async function runMigrations (url: string): Promise<void> {
    const pool = new Pool({ connectionString: url, max: 1 })
    try {
        await migrate(drizzle(pool), { migrationsFolder: 'drizzle' })
    } finally {
        await pool.end()
    }
}

if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    runMigrations(url).then(() => console.log('migrations applied'), (e) => {
        console.error(e)
        process.exit(1)
    })
}
