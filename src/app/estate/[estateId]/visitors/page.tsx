import { Ban, Download, ScrollText, Search, SlidersHorizontal } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ActionForm, Field, SubmitButton } from '@/components/ActionForm'
import { PhoneInput } from '@/components/PhoneInput'
import { Badge, EmptyState, PageHeader, SectionCard, VISIT_STATUS_TONE } from '@/components/ui'
import { formatDateTime } from '@/lib/format'
import { formatNigerianPhone } from '@/lib/phone'
import { getVisitorRules, listBlockedVisitors, listVisitorLog, visitStatusLabel } from '@/lib/visitors'

import { blockVisitorAction, unblockVisitorAction, updateVisitorRulesAction } from '../actions'
import { loadStaffEstate } from '../context'

export const metadata: Metadata = { title: 'Visitors' }

export default async function VisitorsPage ({ params, searchParams }: { params: Promise<{ estateId: string }>, searchParams: Promise<{ q?: string, from?: string, to?: string }> }) {
    const { estateId } = await params
    const filter = await searchParams
    const { actor, estate, can } = await loadStaffEstate(estateId)
    if (!can('visitors.read')) notFound()
    const [log, rules, blocked] = await Promise.all([
        listVisitorLog(actor, estate.id, { ...filter, limit: 200 }),
        getVisitorRules(actor, estate.id),
        listBlockedVisitors(actor, estate.id),
    ])
    const exportQuery = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]).toString()
    const canManage = can('estate.manage')

    return (
        <div className='space-y-6'>
            <PageHeader title='Visitors' description='Every visitor at the gate: passes and walk-ins.'
                actions={<a href={`/estate/${estate.id}/visitors/export${exportQuery ? `?${exportQuery}` : ''}`} className='btn-secondary'><Download className='h-4 w-4' aria-hidden /> Export CSV</a>} />

            <section>
                <form className='card mb-3 flex flex-wrap items-end gap-3 p-4'>
                    <div className='relative min-w-0 flex-1'>
                        <Search className='pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400' aria-hidden />
                        <input name='q' defaultValue={filter.q} placeholder='Visitor, house, street, phone or plate' aria-label='Search visitors' className='w-full py-2 pl-9' />
                    </div>
                    <label className='flex items-center gap-1.5'>From <input type='date' name='from' defaultValue={filter.from} className='py-2' /></label>
                    <label className='flex items-center gap-1.5'>To <input type='date' name='to' defaultValue={filter.to} className='py-2' /></label>
                    <button className='btn-primary'>Search</button>
                </form>
                {log.length === 0
                    ? <EmptyState icon={ScrollText} title='No visitors found' />
                    : (
                        <div className='table-wrap'>
                            <table className='data-table'>
                                <thead>
                                    <tr><th>When</th><th>Visitor</th><th>House</th><th>Type</th><th>Status</th><th>In</th><th>Out</th><th>Gate</th></tr>
                                </thead>
                                <tbody>
                                    {log.map(({ visit: v, unitLabel, zoneName }) => (
                                        <tr key={v.id}>
                                            <td className='whitespace-nowrap'>{formatDateTime(v.createdAt)}</td>
                                            <td>
                                                <span className='font-medium'>{v.visitorName}</span>
                                                {v.visitorPhone && <span className='block text-xs text-slate-500'>{formatNigerianPhone(v.visitorPhone)}</span>}
                                                {v.vehiclePlate && <span className='block font-mono text-xs text-slate-500'>{v.vehiclePlate}</span>}
                                            </td>
                                            <td>{unitLabel}, {zoneName}</td>
                                            <td>{v.kind === 'pass' ? 'Pass' : 'Walk-in'}</td>
                                            <td><Badge tone={VISIT_STATUS_TONE[v.status]}>{visitStatusLabel(v.status)}</Badge>{v.note ? <span className='mt-1 block text-xs text-slate-500'>{v.note}</span> : null}</td>
                                            <td className='whitespace-nowrap'>{v.checkedInAt ? formatDateTime(v.checkedInAt) : ''}</td>
                                            <td className='whitespace-nowrap'>{v.checkedOutAt ? formatDateTime(v.checkedOutAt) : ''}</td>
                                            <td>{v.gate}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                {log.length === 200 && <p className='mt-1 text-xs text-slate-500'>Showing the latest 200. Narrow the dates or export for more.</p>}
            </section>

            <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
                <SectionCard title='Visitor rules' icon={SlidersHorizontal}>
                    {canManage ? (
                        <ActionForm action={updateVisitorRulesAction.bind(null, estate.id)} className='space-y-4' resetOnSuccess={false}>
                            <Field label='Most passes a resident can create per day' name='maxPassesPerResidentPerDay'>
                                <input id='maxPassesPerResidentPerDay' name='maxPassesPerResidentPerDay' type='number' min={1} max={100} defaultValue={rules.maxPassesPerResidentPerDay} required />
                            </Field>
                            <div className='rounded-xl bg-slate-50 p-3'>
                                <label className='flex items-center gap-2'><input type='checkbox' name='curfewEnabled' defaultChecked={rules.curfew.enabled} className='h-4 w-4' /> Curfew: no visitors admitted between</label>
                                <div className='mt-2 flex items-center gap-2'>
                                    <input type='time' name='curfewStart' defaultValue={rules.curfew.start} aria-label='Curfew starts' required />
                                    <span>and</span>
                                    <input type='time' name='curfewEnd' defaultValue={rules.curfew.end} aria-label='Curfew ends' required />
                                </div>
                            </div>
                            <SubmitButton>Save rules</SubmitButton>
                        </ActionForm>
                    ) : (
                        <p className='text-sm'>Up to {rules.maxPassesPerResidentPerDay} passes per resident per day. Curfew {rules.curfew.enabled ? `${rules.curfew.start} to ${rules.curfew.end}` : 'off'}.</p>
                    )}
                </SectionCard>

                <SectionCard title={`Blocked visitors (${blocked.length})`} icon={Ban}>
                    <ul className='divide-y divide-slate-100'>
                        {blocked.map(b => (
                            <li key={b.id} className='flex items-center justify-between gap-2 py-2 text-sm'>
                                <span><span className='font-medium'>{[b.name, b.phone ? formatNigerianPhone(b.phone) : null].filter(Boolean).join(' · ')}</span> <span className='text-slate-500'>· {b.reason}</span></span>
                                {canManage && <ActionForm action={unblockVisitorAction.bind(null, estate.id, b.id)}><button className='text-sm font-medium text-red-600 hover:underline'>Remove</button></ActionForm>}
                            </li>
                        ))}
                        {blocked.length === 0 && <li className='py-2 text-sm text-slate-500'>Nobody is blocked.</li>}
                    </ul>
                    {canManage && (
                        <ActionForm action={blockVisitorAction.bind(null, estate.id)} className='mt-4 space-y-3'>
                            <Field label='Name' name='name'><input id='bname' name='name' /></Field>
                            <Field label='Phone' name='phone'><PhoneInput name='phone' required={false} /></Field>
                            <Field label='Reason' name='reason'><input id='reason' name='reason' required /></Field>
                            <SubmitButton variant='danger'>Block visitor</SubmitButton>
                        </ActionForm>
                    )}
                </SectionCard>
            </div>
        </div>
    )
}
