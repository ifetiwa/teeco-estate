import Link from 'next/link'

import { countResidents } from '@/lib/residents'
import { listZonesWithUnits } from '@/lib/structure'

import { loadStaffEstate } from './context'

export default async function EstateOverview ({ params }: { params: Promise<{ estateId: string }> }) {
    const { estateId } = await params
    const { actor, estate, isAdmin, access } = await loadStaffEstate(estateId)
    const canSeeResidents = isAdmin || access.staffRoles.includes('finance_officer')
    const [zones, counts] = await Promise.all([
        listZonesWithUnits(actor, estate.id),
        canSeeResidents ? countResidents(actor, estate.id) : Promise.resolve(null),
    ])
    const unitCount = zones.reduce((n, z) => n + z.units.filter(u => u.isActive).length, 0)
    const base = `/estate/${estate.id}`

    return (
        <div className='space-y-6'>
            <div className='grid gap-3 sm:grid-cols-4'>
                <Stat label='Streets & blocks' value={zones.length} />
                <Stat label='Units' value={unitCount} />
                {counts && <Stat label='Residents' value={counts.active} />}
                {counts && <Stat label='Waiting for approval' value={counts.pending} highlight={counts.pending > 0} href={`${base}/residents#approvals`} />}
            </div>

            {isAdmin && (
                <section className='card'>
                    <h2 className='font-semibold'>Invite residents</h2>
                    <p className='mt-1 text-sm text-slate-600'>
                        Share this join code. Residents sign in with their phone, enter the code and choose their house; you approve them.
                    </p>
                    <p className='mt-3 font-mono text-3xl tracking-[0.3em] text-brand-800'>{estate.joinCode}</p>
                </section>
            )}

            {isAdmin && unitCount === 0 && (
                <section className='card border-accent-500'>
                    <h2 className='font-semibold'>Get started</h2>
                    <ol className='mt-2 list-decimal space-y-1 pl-5 text-sm'>
                        <li><Link className='underline' href={`${base}/units`}>Add your streets or blocks and their houses</Link></li>
                        <li><Link className='underline' href={`${base}/residents`}>Add residents, or share the join code</Link></li>
                    </ol>
                </section>
            )}
        </div>
    )
}

function Stat ({ label, value, highlight, href }: { label: string, value: number, highlight?: boolean, href?: string }) {
    const body = (
        <>
            <p className='text-sm text-slate-600'>{label}</p>
            <p className={`mt-1 text-2xl font-semibold ${highlight ? 'text-accent-500' : ''}`}>{value}</p>
        </>
    )
    return href ? <Link href={href} className='card block hover:border-brand-600'>{body}</Link> : <div className='card'>{body}</div>
}
