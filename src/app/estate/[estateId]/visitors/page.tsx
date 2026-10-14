import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ActionForm, Field, SubmitButton } from '@/components/ActionForm'
import { PhoneInput } from '@/components/PhoneInput'
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
            <section>
                <div className='flex flex-wrap items-end justify-between gap-3'>
                    <h1 className='text-xl font-semibold'>Visitor log</h1>
                    <a href={`/estate/${estate.id}/visitors/export${exportQuery ? `?${exportQuery}` : ''}`} className='btn-secondary px-3 py-1 text-sm'>Export CSV</a>
                </div>
                <form className='mt-3 flex flex-wrap items-end gap-2'>
                    <input name='q' defaultValue={filter.q} placeholder='Visitor, house, street, phone or plate' aria-label='Search visitors' className='min-w-0 flex-1 py-1' />
                    <label className='flex items-center gap-1 text-sm'>From <input type='date' name='from' defaultValue={filter.from} className='py-1' /></label>
                    <label className='flex items-center gap-1 text-sm'>To <input type='date' name='to' defaultValue={filter.to} className='py-1' /></label>
                    <button className='btn-secondary px-3 py-1'>Search</button>
                </form>
                <div className='mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white'>
                    <table className='w-full text-left text-sm'>
                        <thead className='bg-slate-50 text-slate-600'>
                            <tr><th className='p-2'>When</th><th className='p-2'>Visitor</th><th className='p-2'>House</th><th className='p-2'>Type</th><th className='p-2'>Status</th><th className='p-2'>In</th><th className='p-2'>Out</th><th className='p-2'>Gate</th></tr>
                        </thead>
                        <tbody>
                            {log.map(({ visit: v, unitLabel, zoneName }) => (
                                <tr key={v.id} className='border-t border-slate-100'>
                                    <td className='whitespace-nowrap p-2'>{formatDateTime(v.createdAt)}</td>
                                    <td className='p-2'>
                                        <span className='font-medium'>{v.visitorName}</span>
                                        {v.visitorPhone && <span className='block text-xs text-slate-500'>{formatNigerianPhone(v.visitorPhone)}</span>}
                                        {v.vehiclePlate && <span className='block font-mono text-xs text-slate-500'>{v.vehiclePlate}</span>}
                                    </td>
                                    <td className='p-2'>{unitLabel}, {zoneName}</td>
                                    <td className='p-2'>{v.kind === 'pass' ? 'Pass' : 'Walk-in'}</td>
                                    <td className='p-2'>{visitStatusLabel(v.status)}{v.note ? <span className='block text-xs text-slate-500'>{v.note}</span> : null}</td>
                                    <td className='whitespace-nowrap p-2'>{v.checkedInAt ? formatDateTime(v.checkedInAt) : ''}</td>
                                    <td className='whitespace-nowrap p-2'>{v.checkedOutAt ? formatDateTime(v.checkedOutAt) : ''}</td>
                                    <td className='p-2'>{v.gate}</td>
                                </tr>
                            ))}
                            {log.length === 0 && <tr><td colSpan={8} className='p-3 text-slate-500'>No visitors found.</td></tr>}
                        </tbody>
                    </table>
                </div>
                {log.length === 200 && <p className='mt-1 text-xs text-slate-500'>Showing the latest 200. Narrow the dates or export for more.</p>}
            </section>

            <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
                <section className='card'>
                    <h2 className='font-semibold'>Visitor rules</h2>
                    {canManage ? (
                        <ActionForm action={updateVisitorRulesAction.bind(null, estate.id)} className='mt-3 space-y-3' resetOnSuccess={false}>
                            <Field label='Most passes a resident can create per day' name='maxPassesPerResidentPerDay'>
                                <input id='maxPassesPerResidentPerDay' name='maxPassesPerResidentPerDay' type='number' min={1} max={100} defaultValue={rules.maxPassesPerResidentPerDay} required />
                            </Field>
                            <label className='flex items-center gap-2'><input type='checkbox' name='curfewEnabled' defaultChecked={rules.curfew.enabled} className='h-4 w-4' /> Curfew: no visitors admitted between</label>
                            <div className='flex items-center gap-2'>
                                <input type='time' name='curfewStart' defaultValue={rules.curfew.start} aria-label='Curfew starts' required />
                                <span>and</span>
                                <input type='time' name='curfewEnd' defaultValue={rules.curfew.end} aria-label='Curfew ends' required />
                            </div>
                            <SubmitButton>Save rules</SubmitButton>
                        </ActionForm>
                    ) : (
                        <p className='mt-2 text-sm'>Up to {rules.maxPassesPerResidentPerDay} passes per resident per day. Curfew {rules.curfew.enabled ? `${rules.curfew.start} to ${rules.curfew.end}` : 'off'}.</p>
                    )}
                </section>

                <section className='card'>
                    <h2 className='font-semibold'>Blocked visitors ({blocked.length})</h2>
                    <ul className='mt-2 divide-y divide-slate-100'>
                        {blocked.map(b => (
                            <li key={b.id} className='flex items-center justify-between gap-2 py-2 text-sm'>
                                <span>{[b.name, b.phone ? formatNigerianPhone(b.phone) : null].filter(Boolean).join(' · ')} <span className='text-slate-500'>· {b.reason}</span></span>
                                {canManage && <ActionForm action={unblockVisitorAction.bind(null, estate.id, b.id)}><button className='text-red-700 underline'>Remove</button></ActionForm>}
                            </li>
                        ))}
                    </ul>
                    {canManage && (
                        <ActionForm action={blockVisitorAction.bind(null, estate.id)} className='mt-3 space-y-2'>
                            <Field label='Name' name='name'><input id='bname' name='name' /></Field>
                            <Field label='Phone' name='phone'><PhoneInput name='phone' required={false} /></Field>
                            <Field label='Reason' name='reason'><input id='reason' name='reason' required /></Field>
                            <SubmitButton variant='danger'>Block visitor</SubmitButton>
                        </ActionForm>
                    )}
                </section>
            </div>
        </div>
    )
}
