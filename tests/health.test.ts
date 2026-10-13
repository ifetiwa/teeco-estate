import { describe, expect, it } from 'vitest'

import { GET } from '@/app/api/health/route'

describe('GET /api/health', () => {

    it('reports the database as reachable', async () => {
        const res = await GET()
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ status: 'ok', db: 'ok' })
    })
})
