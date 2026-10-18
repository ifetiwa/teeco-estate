import { Bell, Building2, ChevronRight, Clock, DoorOpen, House, KeyRound, MapPin, Siren, UserPlus, XCircle } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { ActionForm, SubmitButton } from '@/components/ActionForm'
import { AppHeader } from '@/components/AppHeader'
import { DistressButton } from '@/components/DistressButton'
import { Badge, EmptyState, SectionCard } from '@/components/ui'
import { actorFromUser } from '@/lib/access'
import { requireUser } from '@/lib/auth/current'
import { listOpenAlerts } from '@/lib/emergency'
import { listMyEstates } from '@/lib/estates'
import { formatDateTime } from '@/lib/format'
import { listMyNotifications } from '@/lib/notifications'
import { listMyOccupancies } from '@/lib/residents'
import { listWalkInRequestsForResident } from '@/lib/visitors'

import { decideWalkInAction } from '../home/[occupancyId]/actions'
import { markNotificationsReadAction } from './actions'

export const metadata: Metadata = { title: 'Home' }

const ROLE_LABELS: Record<string, string> = {
    estate_admin: 'Estate admin',
    finance_officer: 'Finance officer',
    guard: 'Guard',
}

function greeting (): string {
    const h = (new Date().getUTCHours() + 1) % 24 // Lagos
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default async function AppHome () {
    const user = await requireUser()
    const actor = actorFromUser(user)
    const [estates, occupancies] = await Promise.all([listMyEstates(actor), listMyOccupancies(actor)])
    const pending = occupancies.filter(o => o.status === 'pending')
    const rejected = occupancies.filter(o => o.status === 'rejected')
    const homes = occupancies.filter(o => o.status === 'active')
    const homeEstates = [...new Set(homes.map(h => h.estateId))]
    const responderEstates = estates.filter(e => e.staffRoles.some(r => r === 'guard' || r === 'estate_admin'))
    const [requestLists, notes, alertLists] = await Promise.all([
        Promise.all(homeEstates.map(id => listWalkInRequestsForResident(actor, id))),
        listMyNotifications(actor, 10),
        Promise.all(responderEstates.map(e => listOpenAlerts(actor, e.id).then(rows => rows.map(r => ({ ...r, estateId: e.id, estateName: e.name }))))),
    ])
    const openAlerts = alertLists.flat()
    const occupancyForUnit = new Map(homes.map(h => [h.unitId, h.id]))
    const requests = requestLists.flat()
    const unread = notes.filter(n => !n.readAt).length
    const managed = estates.filter(e => e.staffRoles.length > 0)

    return (
        <>
            <AppHeader user={user} />
            <div className='bg-gradient-to-r from-brand-800 to-brand-600 text-white'>
                <div className='mx-auto max-w-6xl px-4 py-8'>
                    <p className='text-brand-100'>{greeting()}</p>
                    <h1 className='text-3xl font-bold'>Welcome{user.name ? `, ${user.name.split(' ')[0]}` : ''}</h1>
                    <p className='mt-1 text-brand-100'>
                        {managed.length > 0 && `${managed.length} estate${managed.length > 1 ? 's' : ''} to manage`}
                        {managed.length > 0 && homes.length > 0 && ' · '}
                        {homes.length > 0 && `${homes.length} home${homes.length > 1 ? 's' : ''}`}
                    </p>
                </div>
            </div>

            <main className='mx-auto max-w-6xl space-y-8 px-4 py-6'>
                {openAlerts.length > 0 && (
                    <section className='space-y-3'>
                        <h2 className='flex items-center gap-2 text-lg font-semibold text-red-700'><Siren className='h-5 w-5 animate-pulse' aria-hidden /> Emergency</h2>
                        {openAlerts.map(a => (
                            <div key={a.alert.id} className='card border-red-300 bg-red-50'>
                                <p className='text-lg font-bold text-red-800'>{a.unitLabel}, {a.zoneName} · {a.estateName}</p>
                                <p className='text-sm text-red-700'>{a.raisedByName || 'Resident'} · {formatDateTime(a.alert.createdAt)} · {a.alert.status === 'acknowledged' ? 'Someone is responding' : 'Nobody has responded yet'}</p>
                                <div className='mt-3 flex flex-wrap gap-2'>
                                    <a href={a.mapLink} target='_blank' rel='noreferrer' className='btn-danger'><MapPin className='h-4 w-4' aria-hidden /> Open map</a>
                                    <Link href={`/gate/${a.estateId}`} className='btn-secondary'>Respond from gate console</Link>
                                </div>
                            </div>
                        ))}
                    </section>
                )}

                {requests.length > 0 && (
                    <section className='space-y-3'>
                        <h2 className='flex items-center gap-2 text-lg font-semibold text-accent-600'><DoorOpen className='h-5 w-5' aria-hidden /> Visitor at the gate</h2>
                        {requests.map(v => (
                            <div key={v.id} className='card border-accent-400 bg-accent-50/50'>
                                <p className='text-lg font-semibold'>{v.visitorName} is at gate {v.gate}</p>
                                <p className='text-sm text-slate-600'>{v.purpose || 'No purpose given'} · {formatDateTime(v.createdAt)}</p>
                                <div className='mt-4 grid grid-cols-2 gap-3'>
                                    <ActionForm action={decideWalkInAction.bind(null, occupancyForUnit.get(v.unitId)!, v.id, true)}>
                                        <SubmitButton className='w-full py-3'>Let them in</SubmitButton>
                                    </ActionForm>
                                    <ActionForm action={decideWalkInAction.bind(null, occupancyForUnit.get(v.unitId)!, v.id, false)}>
                                        <SubmitButton variant='danger' className='w-full py-3'>Decline</SubmitButton>
                                    </ActionForm>
                                </div>
                            </div>
                        ))}
                    </section>
                )}

                {homes.length > 0 && (
                    <section>
                        <h2 className='mb-3 text-lg font-semibold'>Your home</h2>
                        <ul className='grid gap-4 sm:grid-cols-2'>
                            {homes.map(h => (
                                <li key={h.id}>
                                    <Link href={`/home/${h.id}`} className='card-link flex items-center gap-4'>
                                        <span className='grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-600'><House className='h-6 w-6' aria-hidden /></span>
                                        <span className='min-w-0 flex-1'>
                                            <span className='block font-semibold'>{h.unitLabel}, {h.zoneName}</span>
                                            <span className='block text-sm text-slate-500'>{h.estateName}{h.isPrimary ? ' · Primary contact' : ''}</span>
                                        </span>
                                        <ChevronRight className='h-5 w-5 text-slate-400' aria-hidden />
                                    </Link>
                                </li>
                            ))}
                        </ul>
                        <div className='mt-4 grid gap-4 sm:grid-cols-2'>
                            {homes.map(h => (
                                <div key={h.id}>
                                    {homes.length > 1 && <p className='mb-1 text-sm font-medium text-slate-600'>{h.unitLabel}, {h.zoneName}</p>}
                                    <DistressButton occupancyId={h.id} compact />
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {managed.length > 0 && (
                    <section>
                        <h2 className='mb-3 text-lg font-semibold'>Your estates</h2>
                        <ul className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
                            {managed.map(e => {
                                const guardOnly = e.staffRoles.length === 1 && e.staffRoles[0] === 'guard'
                                return (
                                    <li key={e.id}>
                                        <Link href={guardOnly ? `/gate/${e.id}` : `/estate/${e.id}`} className='card-link flex h-full items-start gap-4'>
                                            <span className='grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700'>
                                                {guardOnly ? <DoorOpen className='h-6 w-6' aria-hidden /> : <Building2 className='h-6 w-6' aria-hidden />}
                                            </span>
                                            <span className='min-w-0 flex-1'>
                                                <span className='block font-semibold'>{e.name}</span>
                                                <span className='mt-2 flex flex-wrap gap-1.5'>
                                                    {e.staffRoles.map(r => <Badge key={r} tone={r === 'estate_admin' ? 'green' : r === 'guard' ? 'blue' : 'amber'}>{ROLE_LABELS[r]}</Badge>)}
                                                </span>
                                            </span>
                                            <ChevronRight className='h-5 w-5 text-slate-400' aria-hidden />
                                        </Link>
                                    </li>
                                )
                            })}
                        </ul>
                    </section>
                )}

                {(pending.length > 0 || rejected.length > 0) && (
                    <section className='grid gap-4 md:grid-cols-2'>
                        {pending.length > 0 && (
                            <SectionCard title='Waiting for approval' icon={Clock}>
                                <ul className='space-y-2 text-sm'>
                                    {pending.map(p => (
                                        <li key={p.id}>{p.unitLabel}, {p.zoneName}, {p.estateName}. The estate office will review your request.</li>
                                    ))}
                                </ul>
                            </SectionCard>
                        )}
                        {rejected.length > 0 && (
                            <SectionCard title='Requests not approved' icon={XCircle}>
                                <ul className='space-y-2 text-sm'>
                                    {rejected.map(r => <li key={r.id}>{r.unitLabel}, {r.zoneName}, {r.estateName}: {r.rejectionReason}</li>)}
                                </ul>
                            </SectionCard>
                        )}
                    </section>
                )}

                <div id='notifications' className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]'>
                    <SectionCard
                        title={`Notifications${unread ? ` (${unread} new)` : ''}`}
                        icon={Bell}
                        actions={unread > 0 ? <form action={markNotificationsReadAction}><button className='text-sm font-medium text-brand-700 hover:underline'>Mark all read</button></form> : undefined}
                    >
                        {notes.length === 0
                            ? <EmptyState icon={Bell} title='Nothing yet'>Visitor arrivals and estate updates will show here.</EmptyState>
                            : (
                                <ul className='-mx-2 divide-y divide-slate-100'>
                                    {notes.map(n => (
                                        <li key={n.id} className='flex gap-3 px-2 py-3 text-sm'>
                                            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-brand-600'}`} aria-hidden />
                                            <div className='min-w-0'>
                                                <p className={n.readAt ? 'text-slate-700' : 'font-semibold'}>{n.title}</p>
                                                <p className='text-slate-500'>{n.body}</p>
                                                <p className='mt-0.5 text-xs text-slate-400'>{formatDateTime(n.createdAt)}</p>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                    </SectionCard>

                    <SectionCard title='Join an estate' icon={UserPlus}>
                        <p className='text-sm text-slate-600'>Moving in? Ask your estate office for the 6-character join code.</p>
                        <Link href='/join' className='btn-primary mt-4 w-full'><KeyRound className='h-4 w-4' aria-hidden /> Join an estate</Link>
                    </SectionCard>
                </div>
            </main>
        </>
    )
}
