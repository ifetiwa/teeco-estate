import type { Metadata } from 'next'
import Link from 'next/link'

import { ActionForm, SubmitButton } from '@/components/ActionForm'
import { AppHeader } from '@/components/AppHeader'
import { actorFromUser } from '@/lib/access'
import { requireUser } from '@/lib/auth/current'
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

export default async function AppHome () {
    const user = await requireUser()
    const actor = actorFromUser(user)
    const [estates, occupancies] = await Promise.all([listMyEstates(actor), listMyOccupancies(actor)])
    const pending = occupancies.filter(o => o.status === 'pending')
    const rejected = occupancies.filter(o => o.status === 'rejected')
    const homes = occupancies.filter(o => o.status === 'active')
    const homeEstates = [...new Set(homes.map(h => h.estateId))]
    const [requestLists, notes] = await Promise.all([
        Promise.all(homeEstates.map(id => listWalkInRequestsForResident(actor, id))),
        listMyNotifications(actor, 10),
    ])
    const occupancyForUnit = new Map(homes.map(h => [h.unitId, h.id]))
    const requests = requestLists.flat()
    const unread = notes.filter(n => !n.readAt).length

    return (
        <>
            <AppHeader user={user} />
            <main className='mx-auto max-w-5xl px-4 py-6'>
                <h1 className='text-2xl font-semibold'>Welcome{user.name ? `, ${user.name.split(' ')[0]}` : ''}</h1>

                {requests.length > 0 && (
                    <section className='mt-6 space-y-3'>
                        <h2 className='font-semibold text-accent-500'>Visitor at the gate</h2>
                        {requests.map(v => (
                            <div key={v.id} className='card border-accent-500'>
                                <p className='font-medium'>{v.visitorName} is at gate {v.gate}</p>
                                <p className='text-sm text-slate-600'>{v.purpose || 'No purpose given'} · {formatDateTime(v.createdAt)}</p>
                                <div className='mt-3 grid grid-cols-2 gap-2'>
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

                {notes.length > 0 && (
                    <section className='mt-6'>
                        <div className='flex items-center justify-between'>
                            <h2 className='font-semibold text-slate-700'>Notifications{unread ? ` (${unread} new)` : ''}</h2>
                            {unread > 0 && <form action={markNotificationsReadAction}><button className='text-sm text-brand-700 underline'>Mark all read</button></form>}
                        </div>
                        <ul className='mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white'>
                            {notes.map(n => (
                                <li key={n.id} className={`p-3 text-sm ${n.readAt ? 'text-slate-600' : ''}`}>
                                    <p className={n.readAt ? '' : 'font-medium'}>{n.title}</p>
                                    <p className='text-slate-600'>{n.body}</p>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {estates.some(e => e.staffRoles.length > 0) && (
                    <section className='mt-6'>
                        <h2 className='font-semibold text-slate-700'>Estates you manage</h2>
                        <ul className='mt-2 grid gap-3 sm:grid-cols-2'>
                            {estates.filter(e => e.staffRoles.length > 0).map(e => (
                                <li key={e.id}>
                                    <Link href={e.staffRoles.length === 1 && e.staffRoles[0] === 'guard' ? `/gate/${e.id}` : `/estate/${e.id}`} className='card block hover:border-brand-600'>
                                        <span className='font-medium'>{e.name}</span>
                                        <span className='mt-1 block text-sm text-slate-600'>{e.staffRoles.map(r => ROLE_LABELS[r]).join(', ')}</span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {homes.length > 0 && (
                    <section className='mt-6'>
                        <h2 className='font-semibold text-slate-700'>Your home</h2>
                        <ul className='mt-2 grid gap-3 sm:grid-cols-2'>
                            {homes.map(h => (
                                <li key={h.id}>
                                    <Link href={`/home/${h.id}`} className='card block hover:border-brand-600'>
                                        <span className='font-medium'>{h.unitLabel}, {h.zoneName}</span>
                                        <span className='mt-1 block text-sm text-slate-600'>{h.estateName}{h.isPrimary ? ' · Primary contact' : ''}</span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {pending.length > 0 && (
                    <section className='mt-6'>
                        <h2 className='font-semibold text-slate-700'>Waiting for approval</h2>
                        <ul className='mt-2 space-y-2'>
                            {pending.map(p => (
                                <li key={p.id} className='card text-sm'>
                                    {p.unitLabel}, {p.zoneName}, {p.estateName}. The estate office will review your request.
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {rejected.length > 0 && (
                    <section className='mt-6'>
                        <h2 className='font-semibold text-slate-700'>Requests not approved</h2>
                        <ul className='mt-2 space-y-2'>
                            {rejected.map(r => (
                                <li key={r.id} className='card text-sm'>
                                    {r.unitLabel}, {r.zoneName}, {r.estateName}: {r.rejectionReason}
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                <section className='mt-8'>
                    <Link href='/join' className='btn-primary'>Join an estate</Link>
                    <p className='mt-2 text-sm text-slate-600'>Ask your estate office for the 6-character join code.</p>
                </section>
            </main>
        </>
    )
}
