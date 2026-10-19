import { Banknote, CheckCircle2, Circle, Clock, DoorOpen, House, KeyRound, MapPin, Phone, ScrollText, ShieldCheck, Siren, UserCheck, Users } from 'lucide-react'
import Link from 'next/link'

import { CopyButton } from '@/components/CopyButton'
import { PoliceContacts } from '@/components/PoliceContacts'
import { Badge, EmptyState, PageHeader, SectionCard, StatCard, VISIT_STATUS_TONE } from '@/components/ui'
import { getEstatePolice, listOpenAlerts } from '@/lib/emergency'
import { formatDateTime, formatNaira } from '@/lib/format'
import { listPayments } from '@/lib/levies'
import { countResidents } from '@/lib/residents'
import { listStaff } from '@/lib/staff'
import { listZonesWithUnits } from '@/lib/structure'
import { listVisitorLog, visitStatusLabel } from '@/lib/visitors'

import { loadStaffEstate } from './context'

export default async function EstateOverview ({ params }: { params: Promise<{ estateId: string }> }) {
    const { estateId } = await params
    const { actor, estate, can } = await loadStaffEstate(estateId)
    const monthStart = new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 8) + '01'
    const [zones, counts, visits, staff, openAlerts, monthPayments, police] = await Promise.all([
        listZonesWithUnits(actor, estate.id),
        can('residents.read') ? countResidents(actor, estate.id) : Promise.resolve(null),
        can('visitors.read') ? listVisitorLog(actor, estate.id, { limit: 8 }) : Promise.resolve([]),
        can('staff.manage') ? listStaff(actor, estate.id) : Promise.resolve([]),
        can('emergency.respond') ? listOpenAlerts(actor, estate.id) : Promise.resolve([]),
        can('finance.read') ? listPayments(actor, estate.id, { from: monthStart, limit: 1 }) : Promise.resolve(null),
        getEstatePolice(actor, estate.id),
    ])
    const unitCount = zones.reduce((n, z) => n + z.units.filter(u => u.isActive).length, 0)
    const occupied = zones.reduce((n, z) => n + z.units.filter(u => u.occupantCount > 0).length, 0)
    const insideNow = visits.filter(v => v.visit.status === 'checked_in').length
    const base = `/estate/${estate.id}`
    const guardCount = staff.filter(m => m.isActive && m.role === 'guard').length
    const checklist = [
        { done: zones.length > 0 && unitCount > 0, label: 'Add streets or blocks and their houses', href: `${base}/units` },
        { done: staff.some(s => s.isActive && s.role === 'guard'), label: 'Add your gate guards', href: `${base}/staff` },
        { done: (counts?.active ?? 0) > 0, label: 'Add residents or share the join code', href: `${base}/residents` },
        { done: police.station !== null, label: 'Set the estate location and police division', href: `${base}/settings` },
    ]

    return (
        <div className='space-y-6'>
            <PageHeader title='Overview' description='How the estate is doing today.' />

            {openAlerts.length > 0 && (
                <Link href={`${base}/emergencies`} className='flex items-center gap-3 rounded-2xl border-2 border-red-500 bg-red-50 p-4 text-red-800'>
                    <Siren className='h-7 w-7 shrink-0 animate-pulse' aria-hidden />
                    <span>
                        <span className='block font-bold'>{openAlerts.length === 1 ? `Emergency at ${openAlerts[0].unitLabel}, ${openAlerts[0].zoneName}` : `${openAlerts.length} emergencies open`}</span>
                        <span className='text-sm'>Tap to see the location and respond.</span>
                    </span>
                </Link>
            )}

            <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
                <StatCard label='Units' value={unitCount} icon={House} hint={`${zones.length} streets/blocks · ${occupied} occupied`} />
                {counts && <StatCard label='Residents' value={counts.active} icon={Users} tone='slate' />}
                {counts && <StatCard label='Waiting for approval' value={counts.pending} icon={UserCheck} tone={counts.pending > 0 ? 'accent' : 'slate'} href={`${base}/residents#approvals`} />}
                {monthPayments && <StatCard label='Received this month' value={formatNaira(monthPayments.totalKobo)} icon={Banknote} tone='accent' href={`${base}/payments`} hint={`Levy ${formatNaira(monthPayments.byKind.security_levy.totalKobo)} · Service ${formatNaira(monthPayments.byKind.service_charge.totalKobo)}`} />}
                {can('visitors.read') && <StatCard label='Visitors inside now' value={insideNow} icon={DoorOpen} tone='accent' href={can('gate.operate') ? `/gate/${estate.id}` : `${base}/visitors`} />}
            </div>

            <div className='grid gap-6 lg:grid-cols-2'>
                {can('emergency.respond') && (
                    <SectionCard title='Security' icon={ShieldCheck}
                        actions={<Link href={`/security/${estate.id}`} className='text-sm font-medium text-brand-700 hover:underline'>Security dashboard</Link>}>
                        <p className='text-sm text-slate-600'>
                            {openAlerts.length > 0 ? <span className='font-semibold text-red-700'>{openAlerts.length} emergency open. </span> : 'No open emergencies. '}
                            {can('staff.manage') && `${guardCount} guard${guardCount === 1 ? '' : 's'} receive emergency alerts with the address and map, and visitor updates.`}
                        </p>
                        <p className='mt-2 text-xs text-slate-500'>Only guards, estate admins and Teeco super admins are sent the address of an emergency. Other residents are told to stay alert.</p>
                    </SectionCard>
                )}

                <SectionCard title='Police' icon={Phone} description={police.station ? "Your estate's police division, then the FCT Command lines." : 'No police division linked yet.'}
                    actions={can('estate.manage') ? <Link href={`${base}/settings`} className='text-sm font-medium text-brand-700 hover:underline'>{police.station ? 'Change' : 'Set it'}</Link> : undefined}>
                    <PoliceContacts stations={police.station ? [police.station] : []} lines={police.emergencyLines.slice(0, 2)} />
                </SectionCard>

                {can('estate.manage') && (
                    <SectionCard title='Invite residents' description='Residents sign in with their phone, enter this code, and you approve them.' icon={KeyRound}>
                        <div className='flex flex-wrap items-center justify-between gap-3 rounded-xl bg-brand-50 p-4'>
                            <p className='font-mono text-3xl font-bold tracking-[0.3em] text-brand-800'>{estate.joinCode}</p>
                            <CopyButton text={`Join ${estate.name} on Teeco Estate: sign in with your phone and enter join code ${estate.joinCode}.`} label='Copy invite' />
                        </div>
                    </SectionCard>
                )}

                {can('estate.manage') && (
                    <SectionCard title='Setup checklist' icon={CheckCircle2}>
                        <ul className='space-y-1'>
                            {checklist.map(c => (
                                <li key={c.label}>
                                    <Link href={c.href} className='flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-slate-50'>
                                        {c.done ? <CheckCircle2 className='h-5 w-5 text-brand-600' aria-hidden /> : <Circle className='h-5 w-5 text-slate-300' aria-hidden />}
                                        <span className={c.done ? 'text-slate-500 line-through' : 'font-medium'}>{c.label}</span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </SectionCard>
                )}

                {can('visitors.read') && (
                    <SectionCard title='Recent visitors' icon={ScrollText} className='lg:col-span-2'
                        actions={<Link href={`${base}/visitors`} className='text-sm font-medium text-brand-700 hover:underline'>Full log</Link>}>
                        {visits.length === 0
                            ? <EmptyState icon={Clock} title='No visitors yet'>Passes created by residents and walk-ins at the gate appear here.</EmptyState>
                            : (
                                <ul className='-mx-2 divide-y divide-slate-100'>
                                    {visits.map(({ visit: v, unitLabel, zoneName }) => (
                                        <li key={v.id} className='flex flex-wrap items-center justify-between gap-2 px-2 py-2.5 text-sm'>
                                            <span className='min-w-0'>
                                                <span className='font-medium'>{v.visitorName}</span>
                                                <span className='text-slate-500'> → {unitLabel}, {zoneName}</span>
                                            </span>
                                            <span className='flex items-center gap-2'>
                                                <span className='text-xs text-slate-500'>{formatDateTime(v.createdAt)}</span>
                                                <Badge tone={VISIT_STATUS_TONE[v.status]}>{visitStatusLabel(v.status)}</Badge>
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                    </SectionCard>
                )}

                {!can('visitors.read') && !can('estate.manage') && (
                    <SectionCard title='Streets & units' icon={MapPin}>
                        <p className='text-sm text-slate-600'>See the estate layout under Streets & units.</p>
                    </SectionCard>
                )}
            </div>
        </div>
    )
}
