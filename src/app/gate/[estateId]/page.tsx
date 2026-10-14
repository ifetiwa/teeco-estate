import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { AppHeader } from '@/components/AppHeader'
import { actorFromUser } from '@/lib/access'
import { requireUser } from '@/lib/auth/current'
import { getEstateForStaff } from '@/lib/estates'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { formatTime } from '@/lib/format'
import { listZonesWithUnits } from '@/lib/structure'
import { getGateBoard } from '@/lib/visitors'

import { type BoardRow, GateConsole } from './GateConsole'

export const metadata: Metadata = { title: 'Gate' }
export const dynamic = 'force-dynamic'

export default async function GatePage ({ params }: { params: Promise<{ estateId: string }> }) {
    const { estateId } = await params
    const user = await requireUser()
    const actor = actorFromUser(user)
    let estate, access
    try {
        ({ estate, access } = await getEstateForStaff(actor, estateId))
    } catch (e) {
        if (e instanceof ForbiddenError || e instanceof NotFoundError || (e as { code?: string }).code === '22P02') notFound()
        throw e
    }
    if (!access.capabilities.has('gate.operate')) notFound()
    const [board, zones] = await Promise.all([getGateBoard(actor, estate.id), listZonesWithUnits(actor, estate.id)])
    const toRow = (r: (typeof board.inside)[number]): BoardRow => ({
        id: r.visit.id,
        visitorName: r.visit.visitorName,
        purpose: r.visit.purpose,
        vehiclePlate: r.visit.vehiclePlate,
        gate: r.visit.gate,
        unit: `${r.unitLabel}, ${r.zoneName}`,
        time: formatTime(r.visit.checkedInAt ?? r.visit.createdAt),
        note: r.visit.note,
    })
    const units = zones.flatMap(z => z.units.filter(u => u.isActive && u.occupantCount > 0).map(u => ({ id: u.id, label: `${u.label}, ${z.name}` })))

    return (
        <>
            <AppHeader user={user} />
            <main className='mx-auto max-w-lg px-4 py-4'>
                <div className='mb-4 flex items-center justify-between'>
                    <h1 className='text-xl font-semibold'>{estate.name} gate</h1>
                    {access.capabilities.has('estate.manage') && <Link href={`/estate/${estate.id}`} className='text-sm underline'>Estate admin</Link>}
                </div>
                <GateConsole
                    estateId={estate.id}
                    gateCount={board.gateCount}
                    units={units}
                    waiting={board.waiting.map(toRow)}
                    approved={board.approved.map(toRow)}
                    declined={board.declined.map(toRow)}
                    inside={board.inside.map(toRow)}
                />
            </main>
        </>
    )
}
