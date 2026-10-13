import 'dotenv/config'
import { afterAll } from 'vitest'

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

afterAll(async () => {
    const { closeDb } = await import('@/db')
    await closeDb()
})
