import { Eye } from 'lucide-react'
import type { ReactNode } from 'react'

import { AppHeader } from '@/components/AppHeader'
import { EstateNav, type NavItem } from '@/components/EstateNav'
import { Badge } from '@/components/ui'

import { loadStaffEstate } from './context'

const ROLE_LABEL: Record<string, string> = { estate_admin: 'Estate admin', finance_officer: 'Finance officer', guard: 'Guard', resident: 'Resident', support: 'Teeco support' }

export default async function EstateLayout ({ children, params }: { children: ReactNode, params: Promise<{ estateId: string }> }) {
    const { estateId } = await params
    const { user, estate, can, access } = await loadStaffEstate(estateId)
    const base = `/estate/${estate.id}`
    const items: Array<NavItem & { show: boolean }> = [
        { href: base, label: 'Overview', icon: 'overview', exact: true, show: true },
        { href: `${base}/units`, label: 'Streets & units', icon: 'units', show: true },
        { href: `${base}/residents`, label: 'Residents', icon: 'residents', show: can('residents.read') },
        { href: `${base}/payments`, label: 'Payments', icon: 'payments', show: can('finance.read') },
        { href: `${base}/visitors`, label: 'Visitors', icon: 'visitors', show: can('visitors.read') },
        { href: `${base}/emergencies`, label: 'Emergencies', icon: 'emergencies', show: can('emergency.read') },
        { href: `/security/${estate.id}`, label: 'Security', icon: 'security', show: can('emergency.respond') },
        { href: `/gate/${estate.id}`, label: 'Gate', icon: 'gate', show: can('gate.operate') },
        { href: `${base}/staff`, label: 'Staff', icon: 'staff', show: can('staff.manage') },
        { href: `${base}/settings`, label: 'Settings', icon: 'settings', show: can('estate.manage') || can('audit.read') },
    ]

    return (
        <>
            <AppHeader user={user} />
            {access.viaSupport && (
                <div className='bg-accent-500 px-4 py-2 text-center text-sm font-medium text-white'>
                    <Eye className='mr-1 inline h-4 w-4' aria-hidden />
                    Teeco support access: read-only. Every page you open is recorded in this estate&apos;s audit log.
                </div>
            )}
            <div className='bg-gradient-to-r from-brand-800 to-brand-600 text-white'>
                <div className='mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5'>
                    <div className='flex min-w-0 items-center gap-3'>
                        {estate.logoPath
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={`/files/${estate.logoPath}`} alt='' className='h-12 w-12 rounded-xl bg-white object-contain p-1' />
                            : <span className='grid h-12 w-12 place-items-center rounded-xl bg-white/15 text-xl font-bold'>{estate.name[0]}</span>}
                        <div className='min-w-0'>
                            <p className='truncate text-xl font-bold'>{estate.name}</p>
                            <p className='truncate text-sm text-brand-100'>{[estate.district, estate.city].filter(Boolean).join(', ')}</p>
                        </div>
                    </div>
                    <div className='flex flex-wrap gap-1.5'>
                        {access.roles.map(r => <span key={r} className='rounded-full bg-white/15 px-3 py-1 text-xs font-semibold'>{ROLE_LABEL[r]}</span>)}
                        {estate.status !== 'active' && <Badge tone='amber'>{estate.status === 'trial' ? 'Trial' : 'Suspended'}</Badge>}
                    </div>
                </div>
            </div>
            <div className='mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[220px_minmax(0,1fr)]'>
                <aside className='lg:sticky lg:top-20 lg:self-start'>
                    <EstateNav items={items.filter(i => i.show).map(({ show: _show, ...i }) => i)} />
                </aside>
                <main className='min-w-0'>{children}</main>
            </div>
        </>
    )
}
