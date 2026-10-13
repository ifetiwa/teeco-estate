import 'dotenv/config'
import { Pool } from 'pg'

import { runMigrations } from '../scripts/migrate'

// Recreates the test database schema from migrations before the test run.
export default async function setup () {
    const url = process.env.TEST_DATABASE_URL
    if (!url) throw new Error('TEST_DATABASE_URL is not set')
    if (!/test/.test(url)) throw new Error('TEST_DATABASE_URL must point at a test database')
    const pool = new Pool({ connectionString: url, max: 1 })
    await pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;')
    await pool.end()
    await runMigrations(url)
}
