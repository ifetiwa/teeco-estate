import { actorFromUser } from '@/lib/access'
import { getCurrentUser } from '@/lib/auth/current'
import { ForbiddenError } from '@/lib/errors'
import { exportVisitorLogCsv } from '@/lib/visitors'

export async function GET (request: Request, { params }: { params: Promise<{ estateId: string }> }) {
    const user = await getCurrentUser()
    if (!user) return new Response('Sign in required', { status: 401 })
    const { estateId } = await params
    const url = new URL(request.url)
    try {
        const csv = await exportVisitorLogCsv(actorFromUser(user), estateId, {
            q: url.searchParams.get('q') ?? undefined,
            from: url.searchParams.get('from') ?? undefined,
            to: url.searchParams.get('to') ?? undefined,
        })
        const date = new Date().toISOString().slice(0, 10)
        return new Response('﻿' + csv, {
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="visitor-log-${date}.csv"`,
                'Cache-Control': 'no-store',
            },
        })
    } catch (e) {
        if (e instanceof ForbiddenError || (e as { code?: string }).code === '22P02') return new Response('Not found', { status: 404 })
        throw e
    }
}
