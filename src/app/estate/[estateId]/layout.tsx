import Link from 'next/link'
import type { ReactNode } from 'react'

import { AppHeader } from '@/components/AppHeader'

import { loadStaffEstate } from './context'

export default async function EstateLayout ({ children, params }: { children: ReactNode, params: Promise<{ estateId: string }> }) {
    const { estateId } = await params
    const { user, estate, isAdmin, access } = await loadStaffEstate(estateId)
    const base = `/estate/${estate.id}`
    const nav = [
        { href: base, label: 'Overview', show: true },
        { href: `${base}/units`, label: 'Streets & units', show: true },
        { href: `${base}/residents`, label: 'Residents', show: isAdmin || access.staffRoles.includes('finance_officer') },
        { href: `${base}/settings`, label: 'Settings', show: isAdmin },
    ].filter(n => n.show)

    return (
        <>
            <AppHeader user={user} />
            <div className='border-b border-slate-200 bg-white'>
                <div className='mx-auto max-w-5xl px-4'>
                    <p className='pt-3 text-lg font-semibold text-brand-800'>{estate.name}</p>
                    <nav className='-mb-px flex gap-4 overflow-x-auto text-sm'>
                        {nav.map(n => (
                            <Link key={n.href} href={n.href} className='whitespace-nowrap border-b-2 border-transparent py-2 text-slate-600 hover:border-brand-600 hover:text-brand-800'>
                                {n.label}
                            </Link>
                        ))}
                    </nav>
                </div>
            </div>
            <main className='mx-auto max-w-5xl px-4 py-6'>{children}</main>
        </>
    )
}
