import { afterAll, describe, expect, it } from 'vitest'

import { GET } from '@/app/api/health/route'
import { closeDb } from '@/db'

describe('GET /api/health', () => {
    afterAll(closeDb)

    it('reports the database as reachable', async () => {
        const res = await GET()
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ status: 'ok', db: 'ok' })
    })
})
