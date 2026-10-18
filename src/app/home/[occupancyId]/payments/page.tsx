import { Building2, CalendarDays, Receipt } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { AppHeader } from '@/components/AppHeader'
import { CollectionTotals } from '@/components/CollectionTotals'
import { Badge, PageHeader, SectionCard } from '@/components/ui'
import { actorFromUser } from '@/lib/access'
import { requireUser } from '@/lib/auth/current'
import { NotFoundError } from '@/lib/errors'
import { formatDate, formatNaira } from '@/lib/format'
import { CHARGE_KIND_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_STATE_LABEL, estateCollectionTotals, listUnitPayments, yearsIn } from '@/lib/levies'
import { getMyHome } from '@/lib/residents'

export const metadata: Metadata = { title: 'My payments' }

export default async function MyPaymentsPage ({ params, searchParams }: { params: Promise<{ occupancyId: string }>, searchParams: Promise<{ year?: string, estateYear?: string }> }) {
    const { occupancyId } = await params
    const q = await searchParams
    const user = await requireUser()
    const actor = actorFromUser(user)
    let home
    try {
        home = await getMyHome(actor, occupancyId)
    } catch (e) {
        if (e instanceof NotFoundError || (e as { code?: string }).code === '22P02') notFound()
        throw e
    }
    const estateId = home.occupancy.estateId
    const mine = await listUnitPayments(actor, estateId, home.unit.id)
    const estateTotals = mine.estateTotalsShared ? await estateCollectionTotals(actor, estateId) : null
    const myYears = yearsIn(mine.byYear)
    const year = myYears.includes(Number(q.year)) ? Number(q.year) : myYears[0]
    const estateYears = estateTotals ? yearsIn(estateTotals) : []
    const estateYear = estateYears.includes(Number(q.estateYear)) ? Number(q.estateYear) : estateYears[0]
    const base = `/home/${occupancyId}/payments`

    return (
        <>
            <AppHeader user={user} />
            <main className='mx-auto max-w-3xl space-y-6 px-4 py-6'>
                <PageHeader back={{ href: `/home/${occupancyId}`, label: 'My home' }} title='My payments' description={`${home.unit.label}, ${home.zone.name} · ${home.estateName}`} />

                <div className='grid gap-4 sm:grid-cols-2'>
                    {mine.current.map(c => (
                        <div key={c.kind} className='card'>
                            <p className='text-sm font-medium text-slate-500'>{CHARGE_KIND_LABEL[c.kind]} · {c.period.label}</p>
                            <p className='mt-1 flex items-center gap-2 text-2xl font-bold'>
                                {formatNaira(c.paidKobo)}
                                <Badge tone={c.state === 'paid' ? 'green' : c.state === 'part_paid' ? 'amber' : 'red'}>{PAYMENT_STATE_LABEL[c.state]}</Badge>
                            </p>
                            <p className='text-sm text-slate-500'>
                                {c.expectedKobo > 0
                                    ? c.outstandingKobo > 0 ? `${formatNaira(c.outstandingKobo)} still to pay of ${formatNaira(c.expectedKobo)}` : `${formatNaira(c.expectedKobo)} due, paid in full`
                                    : 'Paid so far this period'}
                            </p>
                        </div>
                    ))}
                </div>

                <SectionCard title='What I have paid' icon={CalendarDays} description='Totals by the year and month the estate received your money.'>
                    <CollectionTotals totals={mine.byYear} year={year} yearHref={y => `${base}?year=${y}`} />
                </SectionCard>

                <SectionCard title='Every payment' icon={Receipt}>
                    <ul className='divide-y divide-slate-100'>
                        {mine.rows.map(p => (
                            <li key={p.id} className={`flex items-center justify-between gap-3 py-2 text-sm ${p.voidedAt ? 'text-slate-400' : ''}`}>
                                <span>
                                    <span className='font-medium'>{CHARGE_KIND_LABEL[p.kind]}</span> · {p.period}
                                    <span className='block text-xs text-slate-500'>Paid {formatDate(new Date(p.paidOn))} · {PAYMENT_METHOD_LABEL[p.method]}{p.reference ? ` · Ref ${p.reference}` : ''}{p.voidedAt ? ` · Cancelled: ${p.voidReason}` : ''}</span>
                                </span>
                                <span className={`font-semibold whitespace-nowrap ${p.voidedAt ? 'line-through' : ''}`}>{formatNaira(p.amountKobo)}</span>
                            </li>
                        ))}
                        {mine.rows.length === 0 && <li className='py-2 text-sm text-slate-500'>No payments recorded yet. If you have paid, send your receipt to the estate office.</li>}
                    </ul>
                </SectionCard>

                {estateTotals && (
                    <SectionCard title={`Received by ${home.estateName}`} icon={Building2} description='All houses together. Your estate shares these totals; other houses&apos; payments stay private.'>
                        <CollectionTotals totals={estateTotals} year={estateYear} yearHref={y => `${base}?estateYear=${y}${q.year ? `&year=${q.year}` : ''}`} />
                    </SectionCard>
                )}
            </main>
        </>
    )
}
