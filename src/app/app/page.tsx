import type { Metadata } from 'next'
import Link from 'next/link'

import { AppHeader } from '@/components/AppHeader'
import { actorFromUser } from '@/lib/access'
import { requireUser } from '@/lib/auth/current'
import { listMyEstates } from '@/lib/estates'
import { listMyOccupancies } from '@/lib/residents'

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

    return (
        <>
            <AppHeader user={user} />
            <main className='mx-auto max-w-5xl px-4 py-6'>
                <h1 className='text-2xl font-semibold'>Welcome{user.name ? `, ${user.name.split(' ')[0]}` : ''}</h1>

                {estates.some(e => e.staffRoles.length > 0) && (
                    <section className='mt-6'>
                        <h2 className='font-semibold text-slate-700'>Estates you manage</h2>
                        <ul className='mt-2 grid gap-3 sm:grid-cols-2'>
                            {estates.filter(e => e.staffRoles.length > 0).map(e => (
                                <li key={e.id}>
                                    <Link href={`/estate/${e.id}`} className='card block hover:border-brand-600'>
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
