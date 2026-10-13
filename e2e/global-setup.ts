import 'dotenv/config'

import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

import { Pool } from 'pg'

import { runMigrations } from '../scripts/migrate'

export const PLATFORM_ADMIN_PHONE = '+2348030000001'

/** Recreates the e2e database and the first platform admin before every run. */
export default async function globalSetup () {
    const url = process.env.E2E_DATABASE_URL
    if (!url || !/e2e/.test(url)) throw new Error('E2E_DATABASE_URL must point at an e2e database')
    const pool = new Pool({ connectionString: url, max: 1 })
    await pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;')
    await pool.end()
    await runMigrations(url)
    const admin = new Pool({ connectionString: url, max: 1 })
    await admin.query('insert into users (phone, name, is_platform_admin) values ($1, $2, true)', [PLATFORM_ADMIN_PHONE, 'Teeco Ops'])
    await admin.end()
    mkdirSync('test-results', { recursive: true })
    rmSync(path.resolve('test-results', 'sms-outbox.jsonl'), { force: true })
}
