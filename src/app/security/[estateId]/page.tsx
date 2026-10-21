import { CalendarClock, CheckCircle2, DoorOpen, History, LogIn, Phone, ScrollText, ShieldAlert } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { AppHeader } from '@/components/AppHeader'
import { KeepAwake } from '@/components/KeepAwake'
import { AutoRefresh } from '@/components/AutoRefresh'
import { EmergencyPanel, toPanelAlert } from '@/components/EmergencyPanel'
import { PoliceContacts } from '@/components/PoliceContacts'
import { Badge, EmptyState, SectionCard, StatCard, VISIT_STATUS_TONE } from '@/components/ui'
import { actorFromUser } from '@/lib/access'
import { requireUser } from '@/lib/auth/current'
import { DISTRESS_STATUS_LABEL } from '@/lib/emergency'
import { getEstateForStaff } from '@/lib/estates'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { formatDateTime, formatTime } from '@/lib/format'
import { getSecurityDashboard } from '@/lib/security'
import { visitStatusLabel } from '@/lib/visitors'

import { acknowledgeAlertAction, resolveAlertAction } from '../../gate/[estateId]/actions'

export const metadata: Metadata = { title: 'Security' }
export const dynamic = 'force-dynamic'

/** The security team's dashboard: SOS alerts first, then today's visitors and the gate's latest activity. */
export default async function SecurityDashboard ({ params }: { params: Promise<{ estateId: string }> }) {
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
    if (!access.capabilities.has('emergency.respond')) notFound()
    const d = await getSecurityDashboard(actor, estate.id)
    const canGate = access.capabilities.has('gate.operate')

    return (
        <>
            <AppHeader user={user} />
            <AutoRefresh seconds={15} />
            <KeepAwake />
            <div className='bg-gradient-to-r from-slate-900 to-slate-700 text-white'>
                <div className='mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5'>
                    <div>
                        <p className='text-sm text-slate-300'>Security dashboard</p>
                        <h1 className='text-2xl font-bold'>{estate.name}</h1>
                    </div>
                    <div className='flex flex-wrap gap-2'>
                        {canGate && <Link href={`/gate/${estate.id}`} className='inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100'><DoorOpen className='h-4 w-4' aria-hidden /> Gate console</Link>}
                        {access.capabilities.has('estate.manage') && <Link href={`/estate/${estate.id}`} className='rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/25'>Estate admin</Link>}
                    </div>
                </div>
            </div>

            <main className='mx-auto max-w-6xl space-y-6 px-4 py-6'>
                {d.openAlerts.length > 0
                    ? (
                        <EmergencyPanel alerts={d.openAlerts.map(toPanelAlert)}
                            acknowledge={id => acknowledgeAlertAction.bind(null, estate.id, id)}
                            resolve={id => resolveAlertAction.bind(null, estate.id, id)} />
                    )
                    : (
                        <div className='flex items-center gap-3 rounded-2xl bg-brand-50 px-4 py-3 text-brand-800 ring-1 ring-brand-200'>
                            <CheckCircle2 className='h-6 w-6' aria-hidden />
                            <p className='font-medium'>No emergencies right now. This page updates by itself and beeps when a resident presses the emergency button.</p>
                        </div>
                    )}

                <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
                    <StatCard label='Visitors inside now' value={d.counts.insideNow} icon={DoorOpen} href={canGate ? `/gate/${estate.id}` : undefined} />
                    <StatCard label='Arrived today' value={d.counts.arrivalsToday} icon={LogIn} tone='slate' />
                    <StatCard label='Expected today' value={d.expected.length} icon={CalendarClock} tone='accent' />
                    <StatCard label='Waiting for a resident' value={d.counts.waiting} icon={ShieldAlert} tone={d.counts.waiting ? 'red' : 'slate'} hint={d.counts.deniedToday ? `${d.counts.deniedToday} turned away today` : undefined} />
                </div>

                <div className='grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]'>
                    <div className='space-y-6'>
                        <SectionCard title='Expected visitors' icon={CalendarClock} description='Passes residents have created for today.'>
                            {d.expected.length === 0
                                ? <EmptyState icon={CalendarClock} title='Nobody expected'>New passes appear here and as notifications.</EmptyState>
                                : (
                                    <ul className='divide-y divide-slate-100'>
                                        {d.expected.map(({ pass: p, unitLabel, zoneName }) => (
                                            <li key={p.id} className='flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm'>
                                                <span className='min-w-0'>
                                                    <span className='font-semibold'>{p.visitorName}</span>
                                                    <span className='text-slate-500'> → {unitLabel}, {zoneName}</span>
                                                    {p.purpose && <span className='block text-xs text-slate-500'>{p.purpose}</span>}
                                                </span>
                                                <span className='flex items-center gap-2 text-xs text-slate-500'>
                                                    {p.vehiclePlate && <span className='rounded bg-slate-100 px-1.5 py-0.5 font-mono font-semibold text-slate-700'>{p.vehiclePlate}</span>}
                                                    {formatTime(p.validFrom)}–{formatTime(p.validUntil)}
                                                    {p.usage === 'multi' && <Badge tone='blue'>Multi-use</Badge>}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                        </SectionCard>

                        <SectionCard title='Gate activity today' icon={ScrollText}>
                            {d.activity.length === 0
                                ? <EmptyState icon={ScrollText} title='No activity yet today' />
                                : (
                                    <ul className='divide-y divide-slate-100'>
                                        {d.activity.map(({ visit: v, unitLabel, zoneName }) => (
                                            <li key={v.id} className='flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm'>
                                                <span className='min-w-0'>
                                                    <span className='font-medium'>{v.visitorName}</span>
                                                    <span className='text-slate-500'> → {unitLabel}, {zoneName} · gate {v.gate}</span>
                                                    {v.note && <span className='block text-xs text-slate-500'>{v.note}</span>}
                                                </span>
                                                <span className='flex items-center gap-2'>
                                                    <span className='text-xs text-slate-500'>{formatTime(v.checkedOutAt ?? v.checkedInAt ?? v.createdAt)}</span>
                                                    <Badge tone={VISIT_STATUS_TONE[v.status]}>{visitStatusLabel(v.status)}</Badge>
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                        </SectionCard>
                    </div>

                    <div className='space-y-6'>
                        <SectionCard title='Police and emergency numbers' icon={Phone} description='The estate&apos;s police division first. Tap to call.'>
                            <PoliceContacts stations={d.stations} lines={d.emergencyLines} />
                        </SectionCard>

                        <SectionCard title='Recent alerts' icon={History}>
                            {d.closedAlerts.length === 0
                                ? <p className='text-sm text-slate-500'>No past alerts.</p>
                                : (
                                    <ul className='space-y-2 text-sm'>
                                        {d.closedAlerts.map(({ alert: a, unitLabel, zoneName }) => (
                                            <li key={a.id}>
                                                <span className='font-medium'>{unitLabel}, {zoneName}</span>
                                                <span className='text-slate-500'> · {formatDateTime(a.createdAt)}</span>
                                                <span className='block text-xs text-slate-500'><Badge tone='slate'>{DISTRESS_STATUS_LABEL[a.status]}</Badge> {a.closingNote}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            {access.capabilities.has('emergency.read') && (
                                <Link href={`/estate/${estate.id}/emergencies`} className='mt-3 inline-block text-sm font-medium text-brand-700 hover:underline'>All alerts</Link>
                            )}
                        </SectionCard>
                    </div>
                </div>
            </main>
        </>
    )
}
