import { BellRing, CheckCircle2, CircleDashed, Home, Settings2, XCircle } from 'lucide-react'
import Link from 'next/link'

import { ActionForm, Field, SubmitButton } from '@/components/ActionForm'
import { ContactLinks } from '@/components/ContactLinks'
import { Badge, type BadgeTone, SectionCard, StatCard } from '@/components/ui'
import { formatDateTime, formatNaira } from '@/lib/format'
import { CHARGE_KINDS, CHARGE_KIND_LABEL, PAYMENT_STATE_LABEL, type PaymentState, type getChargeSettings, type paymentStatus } from '@/lib/levies'
import { FREQUENCY_LABEL, recentPeriods } from '@/lib/periods'

import { remindAllAction, remindHouseAction, updateChargeSettingsAction } from '../actions'

const STATE_TONE: Record<PaymentState, BadgeTone> = { paid: 'green', part_paid: 'amber', unpaid: 'red', vacant: 'slate' }
const FILTERS: Array<{ key: string, label: string }> = [
    { key: 'owing', label: 'Not paid' }, { key: 'paid', label: 'Paid' }, { key: 'all', label: 'All houses' },
]

/** Who has and hasn't paid one charge for one period, with contact links, reminders and the charge settings. */
export function StatusView ({ estateId, estateName, status, charges, show, canManage }: {
    estateId: string
    estateName: string
    status: Awaited<ReturnType<typeof paymentStatus>>
    charges: Awaited<ReturnType<typeof getChargeSettings>>
    show: string
    canManage: boolean
}) {
    const { kind, period, summary, expectedKobo } = status
    const href = (o: { kind?: string, period?: string, show?: string }) => {
        const q = new URLSearchParams({ view: 'status', kind: o.kind ?? kind, period: o.period ?? period.key, show: o.show ?? show })
        if (o.kind && o.kind !== kind) q.delete('period')
        return `?${q.toString()}`
    }
    const rows = status.rows.filter(r => show === 'all' ? true : show === 'paid' ? r.state === 'paid' : r.state === 'unpaid' || r.state === 'part_paid')
    const owing = summary.unpaid + summary.partPaid
    const chargeName = CHARGE_KIND_LABEL[kind].toLowerCase()
    const messageFor = (house: string, outstanding: number) =>
        `Hello, this is ${estateName} estate office. Our records show your ${chargeName} for ${period.label}${outstanding ? ` (${formatNaira(outstanding)})` : ''} for ${house} has not been paid. Please pay and send your receipt. Thank you.`

    return (
        <div className='space-y-4'>
            <div className='card flex flex-wrap items-end gap-3 p-4'>
                <div className='flex gap-2'>
                    {CHARGE_KINDS.map(k => (
                        <Link key={k} href={href({ kind: k })} className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${k === kind ? 'bg-brand-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'}`}>{CHARGE_KIND_LABEL[k]}</Link>
                    ))}
                </div>
                <form className='flex items-end gap-2'>
                    <input type='hidden' name='view' value='status' />
                    <input type='hidden' name='kind' value={kind} />
                    <input type='hidden' name='show' value={show} />
                    <label className='flex items-center gap-1.5'>Period
                        <select name='period' defaultValue={period.key} className='py-2'>
                            {recentPeriods(status.frequency).map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                        </select>
                    </label>
                    <button className='btn-secondary'>Show</button>
                </form>
                <p className='text-sm text-slate-500'>
                    {expectedKobo > 0 ? `${formatNaira(expectedKobo)} ${FREQUENCY_LABEL[status.frequency].toLowerCase()} per house.` : 'No amount set: any payment counts as paid.'}
                </p>
            </div>

            <div className='grid gap-4 sm:grid-cols-2 2xl:grid-cols-4'>
                <StatCard label={`Paid, ${period.label}`} value={summary.paid} icon={CheckCircle2} />
                <StatCard label='Part paid' value={summary.partPaid} icon={CircleDashed} tone='accent' />
                <StatCard label='Not paid' value={summary.unpaid} icon={XCircle} tone='red' />
                <StatCard label='Collected' value={formatNaira(summary.collectedKobo)} icon={Home} tone='slate'
                    hint={summary.expectedKobo ? `of ${formatNaira(summary.expectedKobo)} expected from occupied houses` : undefined} />
            </div>

            {canManage && owing > 0 && (
                <SectionCard title={`Remind the ${owing} house${owing === 1 ? '' : 's'} that ${owing === 1 ? 'hasn\'t' : 'haven\'t'} paid`} icon={BellRing}
                    description='Each current resident gets an SMS and an in-app notification. Houses reminded in the last 20 hours are skipped.'>
                    <ActionForm action={remindAllAction.bind(null, estateId, kind, period.key)} className='flex flex-col gap-3 sm:flex-row sm:items-end'>
                        <div className='flex-1'>
                            <Field label='Add a note (optional)' name='message' hint='e.g. Pay to Zenith Bank 1234567890, Sunshine Gardens RA'>
                                <input id='message' name='message' maxLength={300} />
                            </Field>
                        </div>
                        <SubmitButton>Send reminders</SubmitButton>
                    </ActionForm>
                </SectionCard>
            )}

            <div className='flex flex-wrap gap-2'>
                {FILTERS.map(f => (
                    <Link key={f.key} href={href({ show: f.key })} className={`rounded-full px-3 py-1 text-sm font-medium ${show === f.key ? 'bg-slate-800 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
                        {f.label} ({f.key === 'all' ? status.rows.length : f.key === 'paid' ? summary.paid : owing})
                    </Link>
                ))}
            </div>

            <div className='table-wrap'>
                <table className='data-table'>
                    <thead><tr><th>House / flat</th><th>Residents</th><th className='text-right'>Paid</th><th>Status</th><th>Reminded</th>{canManage && <th />}</tr></thead>
                    <tbody>
                        {rows.map(r => {
                            const house = `${r.unitLabel}, ${r.zoneName}`
                            return (
                                <tr key={r.unitId}>
                                    <td>
                                        <span className='font-semibold whitespace-nowrap'>{house}</span>
                                        <span className='block text-xs text-slate-500 capitalize'>{r.unitType}</span>
                                    </td>
                                    <td>
                                        {r.residents.length === 0 && <span className='text-sm text-slate-400'>Nobody living here</span>}
                                        <ul className='space-y-1.5'>
                                            {r.residents.map(p => (
                                                <li key={p.phone}>
                                                    <span className='text-sm font-medium'>{p.name}</span>
                                                    <span className='text-xs text-slate-500'> · {p.relation}{p.isPrimary ? ', primary' : ''}</span>
                                                    <div className='mt-0.5'><ContactLinks phone={p.phone} text={r.state === 'paid' ? undefined : messageFor(house, r.outstandingKobo)} /></div>
                                                </li>
                                            ))}
                                        </ul>
                                    </td>
                                    <td className='text-right whitespace-nowrap'>
                                        {formatNaira(r.paidKobo)}
                                        {r.outstandingKobo > 0 && r.state !== 'vacant' && <span className='block text-xs text-red-600'>{formatNaira(r.outstandingKobo)} owing</span>}
                                    </td>
                                    <td><Badge tone={STATE_TONE[r.state]}>{PAYMENT_STATE_LABEL[r.state]}</Badge></td>
                                    <td className='text-xs whitespace-nowrap text-slate-500'>{r.lastRemindedAt ? <>{formatDateTime(r.lastRemindedAt)}{r.reminderCount > 1 && <span className='block'>{r.reminderCount} times</span>}</> : ''}</td>
                                    {canManage && (
                                        <td className='space-y-1.5'>
                                            {(r.state === 'unpaid' || r.state === 'part_paid') && (
                                                <ActionForm action={remindHouseAction.bind(null, estateId, kind, period.key, r.unitId)}>
                                                    <SubmitButton variant='secondary' className='px-3 py-1.5 text-xs whitespace-nowrap'><BellRing className='h-3.5 w-3.5' aria-hidden /> Remind</SubmitButton>
                                                </ActionForm>
                                            )}
                                            {r.state !== 'paid' && (
                                                <Link href={`?view=payments&record=${r.unitId}&kind=${kind}&from=${period.key}`} className='block text-xs font-medium whitespace-nowrap text-brand-700 hover:underline'>Record payment</Link>
                                            )}
                                        </td>
                                    )}
                                </tr>
                            )
                        })}
                        {rows.length === 0 && <tr><td colSpan={6} className='text-slate-500'>{show === 'owing' ? 'Every occupied house has paid for this period.' : 'No houses.'}</td></tr>}
                    </tbody>
                </table>
            </div>

            {canManage && (
                <SectionCard title='Charges' icon={Settings2} description='How much each house pays, and how often. Used to work out who has paid in full.'>
                    <ActionForm action={updateChargeSettingsAction.bind(null, estateId)} className='grid gap-4 sm:grid-cols-2' resetOnSuccess={false}>
                        <div className='grid grid-cols-2 gap-2'>
                            <Field label='Security levy (₦)' name='securityAmount'>
                                <input id='securityAmount' name='securityAmount' inputMode='decimal' placeholder='15,000' defaultValue={charges.charges.security_levy.amountKobo ? charges.charges.security_levy.amountKobo / 100 : ''} />
                            </Field>
                            <Field label='Every' name='securityFrequency'>
                                <select id='securityFrequency' name='securityFrequency' defaultValue={charges.charges.security_levy.frequency}>
                                    <option value='monthly'>Month</option><option value='quarterly'>Quarter</option><option value='yearly'>Year</option>
                                </select>
                            </Field>
                        </div>
                        <div className='grid grid-cols-2 gap-2'>
                            <Field label='Service charge (₦)' name='serviceAmount'>
                                <input id='serviceAmount' name='serviceAmount' inputMode='decimal' placeholder='120,000' defaultValue={charges.charges.service_charge.amountKobo ? charges.charges.service_charge.amountKobo / 100 : ''} />
                            </Field>
                            <Field label='Every' name='serviceFrequency'>
                                <select id='serviceFrequency' name='serviceFrequency' defaultValue={charges.charges.service_charge.frequency}>
                                    <option value='monthly'>Month</option><option value='quarterly'>Quarter</option><option value='yearly'>Year</option>
                                </select>
                            </Field>
                        </div>
                        <label className='flex items-center gap-2 text-sm sm:col-span-2'>
                            <input type='checkbox' name='showEstateTotalsToResidents' defaultChecked={charges.showEstateTotalsToResidents} className='h-4 w-4' />
                            Let residents see the estate&apos;s total collections per month and year (never other houses&apos; payments)
                        </label>
                        <div className='sm:col-span-2'><SubmitButton>Save charges</SubmitButton></div>
                    </ActionForm>
                </SectionCard>
            )}
        </div>
    )
}
