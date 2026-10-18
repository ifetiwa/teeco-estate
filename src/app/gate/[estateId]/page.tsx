import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { AppHeader } from '@/components/AppHeader'
import { EmergencyPanel, type PanelAlert, toPanelAlert } from '@/components/EmergencyPanel'
import { actorFromUser } from '@/lib/access'
import { requireUser } from '@/lib/auth/current'
import { listOpenAlerts } from '@/lib/emergency'
import { getEstateForStaff } from '@/lib/estates'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { formatTime } from '@/lib/format'
import { listZonesWithUnits } from '@/lib/structure'
import { getGateBoard } from '@/lib/visitors'

import { acknowledgeAlertAction, resolveAlertAction } from './actions'
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
    const canRespond = access.capabilities.has('emergency.respond')
    const [board, zones, openAlerts] = await Promise.all([
        getGateBoard(actor, estate.id),
        listZonesWithUnits(actor, estate.id),
        canRespond ? listOpenAlerts(actor, estate.id) : Promise.resolve([]),
    ])
    const alerts: PanelAlert[] = openAlerts.map(toPanelAlert)
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
            <div className='bg-gradient-to-r from-brand-800 to-brand-600 text-white'>
                <div className='mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-4'>
                    <div>
                        <p className='text-sm text-brand-100'>Gate console</p>
                        <h1 className='text-xl font-bold'>{estate.name} gate</h1>
                    </div>
                    {access.capabilities.has('estate.manage') && <Link href={`/estate/${estate.id}`} className='rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/25'>Estate admin</Link>}
                </div>
            </div>
            <main className='mx-auto max-w-lg space-y-5 px-4 py-5'>
                <EmergencyPanel alerts={alerts} acknowledge={id => acknowledgeAlertAction.bind(null, estate.id, id)} resolve={id => resolveAlertAction.bind(null, estate.id, id)} />
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
