import 'dotenv/config'
import { Pool } from 'pg'

import { runMigrations } from '../scripts/migrate'

// Recreates the test database schema from migrations (as owner) and grants the restricted app role.
export default async function setup () {
    const ownerUrl = process.env.TEST_DATABASE_OWNER_URL
    const appUrl = process.env.TEST_DATABASE_URL
    if (!ownerUrl || !appUrl) throw new Error('TEST_DATABASE_OWNER_URL and TEST_DATABASE_URL must be set')
    if (!/test/.test(ownerUrl) || !/test/.test(appUrl)) throw new Error('Test database URLs must point at a test database')
    const pool = new Pool({ connectionString: ownerUrl, max: 1 })
    await pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;')
    await pool.end()
    await runMigrations(ownerUrl, appUrl)
}
