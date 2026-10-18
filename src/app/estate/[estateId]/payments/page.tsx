import { Banknote, Home, PlusCircle, Receipt, Search, ShieldCheck, Wrench } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ActionForm, Field, SubmitButton } from '@/components/ActionForm'
import { Badge, EmptyState, PageHeader, SectionCard, StatCard } from '@/components/ui'
import { chargeKind, paymentMethod } from '@/db/schema'
import { formatDate, formatNaira } from '@/lib/format'
import { CHARGE_KIND_LABEL, PAYMENT_METHOD_LABEL, listPayments, paymentsByUnit } from '@/lib/levies'
import { listZonesWithUnits } from '@/lib/structure'

import { recordPaymentAction, voidPaymentAction } from '../actions'
import { loadStaffEstate } from '../context'

export const metadata: Metadata = { title: 'Payments' }

type Filter = { q?: string, kind?: string, from?: string, to?: string, voided?: string, view?: string }

export default async function PaymentsPage ({ params, searchParams }: { params: Promise<{ estateId: string }>, searchParams: Promise<Filter> }) {
    const { estateId } = await params
    const filter = await searchParams
    const { actor, estate, can } = await loadStaffEstate(estateId)
    if (!can('finance.read')) notFound()
    const canManage = can('finance.manage')
    const byHouse = filter.view === 'houses'
    const [list, houses, zones] = await Promise.all([
        listPayments(actor, estate.id, { ...filter, includeVoided: filter.voided === 'on' }),
        byHouse ? paymentsByUnit(actor, estate.id, filter) : Promise.resolve([]),
        canManage ? listZonesWithUnits(actor, estate.id) : Promise.resolve([]),
    ])
    const unitOptions = zones.flatMap(z => z.units.filter(u => u.isActive).map(u => ({ id: u.id, label: `${u.label}, ${z.name}` })))
    const today = new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 10)
    const filtered = Boolean(filter.q || filter.kind || filter.from || filter.to)
    const tab = (view: string | undefined, label: string) => {
        const q = new URLSearchParams(Object.entries({ ...filter, view }).filter(([, v]) => v) as [string, string][]).toString()
        const active = (filter.view ?? '') === (view ?? '')
        return <a href={`?${q}`} className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${active ? 'bg-brand-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'}`}>{label}</a>
    }

    return (
        <div className='space-y-6'>
            <PageHeader title='Payments' description='Security levy and estate service charge payments received from each house.' />

            <div className='grid gap-4 sm:grid-cols-3'>
                <StatCard label={`Security levy${filtered ? ' (filtered)' : ''}`} value={formatNaira(list.byKind.security_levy.totalKobo)} icon={ShieldCheck} hint={`${list.byKind.security_levy.count} payments`} />
                <StatCard label={`Service charge${filtered ? ' (filtered)' : ''}`} value={formatNaira(list.byKind.service_charge.totalKobo)} icon={Wrench} tone='accent' hint={`${list.byKind.service_charge.count} payments`} />
                <StatCard label='Total received' value={formatNaira(list.totalKobo)} icon={Banknote} tone='slate' />
            </div>

            <div className={`grid grid-cols-1 gap-6 ${canManage ? '2xl:grid-cols-[minmax(0,1fr)_340px]' : ''}`}>
                <section className='min-w-0 space-y-3'>
                    <div className='flex gap-2'>{tab(undefined, 'All payments')}{tab('houses', 'By house')}</div>
                    <form className='card flex flex-wrap items-end gap-3 p-4'>
                        {filter.view && <input type='hidden' name='view' value={filter.view} />}
                        <div className='relative min-w-56 flex-1'>
                            <Search className='pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400' aria-hidden />
                            <input name='q' defaultValue={filter.q} placeholder='House, street, payer, reference or period' aria-label='Search payments' className='w-full py-2 pl-9' />
                        </div>
                        <select name='kind' defaultValue={filter.kind ?? ''} aria-label='Charge' className='py-2'>
                            <option value=''>All charges</option>
                            {chargeKind.enumValues.map(k => <option key={k} value={k}>{CHARGE_KIND_LABEL[k]}</option>)}
                        </select>
                        <label className='flex items-center gap-1.5'>From <input type='date' name='from' defaultValue={filter.from} className='py-2' /></label>
                        <label className='flex items-center gap-1.5'>To <input type='date' name='to' defaultValue={filter.to} className='py-2' /></label>
                        {!byHouse && <label className='flex items-center gap-1.5 text-sm'><input type='checkbox' name='voided' defaultChecked={filter.voided === 'on'} className='h-4 w-4' /> Show voided</label>}
                        <button className='btn-primary'>Search</button>
                    </form>

                    {byHouse
                        ? (
                            <div className='table-wrap'>
                                <table className='data-table'>
                                    <thead><tr><th>House</th><th className='text-right'>Security levy</th><th className='text-right'>Service charge</th><th>Last paid</th></tr></thead>
                                    <tbody>
                                        {houses.map(h => (
                                            <tr key={h.unitId}>
                                                <td className='font-medium'>{h.unitLabel}, {h.zoneName}</td>
                                                <td className='text-right'>{h.securityKobo ? formatNaira(h.securityKobo) : <span className='text-slate-400'>Nothing</span>}</td>
                                                <td className='text-right'>{h.serviceKobo ? formatNaira(h.serviceKobo) : <span className='text-slate-400'>Nothing</span>}</td>
                                                <td className='whitespace-nowrap'>{h.lastPaidOn ? formatDate(new Date(h.lastPaidOn)) : ''}</td>
                                            </tr>
                                        ))}
                                        {houses.length === 0 && <tr><td colSpan={4} className='text-slate-500'>No houses yet.</td></tr>}
                                    </tbody>
                                </table>
                            </div>
                        )
                        : list.rows.length === 0
                            ? <EmptyState icon={Receipt} title='No payments found'>{canManage ? 'Record a payment with the form.' : 'Payments recorded by the finance officer show here.'}</EmptyState>
                            : (
                                <div className='table-wrap'>
                                    <table className='data-table'>
                                        <thead><tr><th>Paid on</th><th>House</th><th>Charge</th><th>Period</th><th className='text-right'>Amount</th><th>Method</th><th>Recorded by</th>{canManage && <th />}</tr></thead>
                                        <tbody>
                                            {list.rows.map(({ payment: p, unitLabel, zoneName, recordedByName }) => (
                                                <tr key={p.id} className={p.voidedAt ? 'text-slate-400' : ''}>
                                                    <td className='whitespace-nowrap'>{formatDate(new Date(p.paidOn))}</td>
                                                    <td>
                                                        <span className='font-medium whitespace-nowrap'>{unitLabel}, {zoneName}</span>
                                                        {p.payerName && <span className='block text-xs text-slate-500'>{p.payerName}</span>}
                                                    </td>
                                                    <td className='whitespace-nowrap'><Badge tone={p.kind === 'security_levy' ? 'green' : 'amber'}>{CHARGE_KIND_LABEL[p.kind]}</Badge></td>
                                                    <td className='whitespace-nowrap'>{p.period}</td>
                                                    <td className={`text-right font-semibold whitespace-nowrap ${p.voidedAt ? 'line-through' : ''}`}>{formatNaira(p.amountKobo)}</td>
                                                    <td>{PAYMENT_METHOD_LABEL[p.method]}{p.reference && <span className='block font-mono text-xs text-slate-500'>{p.reference}</span>}</td>
                                                    <td className='text-sm'>{recordedByName}{p.voidedAt && <span className='block text-xs text-red-600'>Voided: {p.voidReason}</span>}</td>
                                                    {canManage && (
                                                        <td>
                                                            {!p.voidedAt && (
                                                                <details>
                                                                    <summary className='cursor-pointer text-sm font-medium text-red-600'>Void</summary>
                                                                    <ActionForm action={voidPaymentAction.bind(null, estate.id, p.id)} className='mt-2 flex w-56 flex-col gap-2'>
                                                                        <input name='reason' required minLength={5} placeholder='Reason, e.g. wrong house' aria-label='Reason for voiding' className='py-1.5 text-sm' />
                                                                        <SubmitButton variant='danger' className='px-3 py-1.5'>Void payment</SubmitButton>
                                                                    </ActionForm>
                                                                </details>
                                                            )}
                                                        </td>
                                                    )}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                    {!byHouse && list.rows.length === 200 && <p className='text-xs text-slate-500'>Showing the latest 200. Narrow the dates to see older payments.</p>}
                </section>

                {canManage && (
                    <SectionCard title='Record a payment' icon={PlusCircle} className='order-first h-fit 2xl:order-none'>
                        {unitOptions.length === 0
                            ? <EmptyState icon={Home} title='No houses yet'>Add streets and houses first.</EmptyState>
                            : (
                                <ActionForm action={recordPaymentAction.bind(null, estate.id)} className='grid gap-3 sm:grid-cols-2 2xl:grid-cols-1'>
                                    <Field label='House' name='unitId'>
                                        <select id='unitId' name='unitId' required defaultValue=''>
                                            <option value='' disabled>Choose a house</option>
                                            {unitOptions.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
                                        </select>
                                    </Field>
                                    <Field label='Charge' name='kind'>
                                        <select id='kind' name='kind' defaultValue='security_levy'>
                                            {chargeKind.enumValues.map(k => <option key={k} value={k}>{CHARGE_KIND_LABEL[k]}</option>)}
                                        </select>
                                    </Field>
                                    <Field label='Amount (₦)' name='amount'><input id='amount' name='amount' inputMode='decimal' placeholder='25,000' required /></Field>
                                    <Field label='Covers' name='period' hint='e.g. October 2026, Q4 2026 or 2026'><input id='period' name='period' required /></Field>
                                    <div className='grid grid-cols-2 gap-3'>
                                        <Field label='Paid on' name='paidOn'><input id='paidOn' name='paidOn' type='date' max={today} defaultValue={today} required /></Field>
                                        <Field label='Method' name='method'>
                                            <select id='method' name='method' defaultValue='bank_transfer'>
                                                {paymentMethod.enumValues.map(m => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
                                            </select>
                                        </Field>
                                    </div>
                                    <Field label='Reference (optional)' name='reference'><input id='reference' name='reference' placeholder='Bank or receipt reference' /></Field>
                                    <Field label='Paid by (optional)' name='payerName'><input id='payerName' name='payerName' /></Field>
                                    <Field label='Note (optional)' name='note'><input id='note' name='note' /></Field>
                                    <SubmitButton>Record payment</SubmitButton>
                                    <p className='text-xs text-slate-500'>The house&apos;s residents are notified. Payments can be voided with a reason, never deleted.</p>
                                </ActionForm>
                            )}
                    </SectionCard>
                )}
            </div>
        </div>
    )
}
