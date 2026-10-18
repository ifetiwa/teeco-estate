import { Car, QrCode, Receipt, Siren, Users, Wrench } from 'lucide-react'
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ActionForm, Field, SubmitButton } from '@/components/ActionForm'
import { AppHeader } from '@/components/AppHeader'
import { DistressButton } from '@/components/DistressButton'
import { PhoneInput } from '@/components/PhoneInput'
import { ActionTile, Avatar, Badge, PageHeader, SectionCard } from '@/components/ui'
import { helperRole } from '@/db/schema'
import { actorFromUser } from '@/lib/access'
import { requireUser } from '@/lib/auth/current'
import { getOpenAlertForUnit } from '@/lib/emergency'
import { NotFoundError } from '@/lib/errors'
import { formatDate, formatNaira } from '@/lib/format'
import { CHARGE_KIND_LABEL, PAYMENT_STATE_LABEL, listUnitPayments } from '@/lib/levies'
import { lagosMonth, yearOf } from '@/lib/periods'
import { formatNigerianPhone } from '@/lib/phone'
import { getMyHome } from '@/lib/residents'

import { addMyHelperAction, addMyVehicleAction, removeMyHelperAction, removeMyVehicleAction } from './actions'

export const metadata: Metadata = { title: 'My home' }

const RELATION: Record<string, string> = { owner: 'Owner', tenant: 'Tenant', household: 'Household' }

export default async function MyHomePage ({ params }: { params: Promise<{ occupancyId: string }> }) {
    const { occupancyId } = await params
    const user = await requireUser()
    let home
    try {
        home = await getMyHome(actorFromUser(user), occupancyId)
    } catch (e) {
        if (e instanceof NotFoundError || (e as { code?: string }).code === '22P02') notFound()
        throw e
    }
    const estateId = home.occupancy.estateId
    const thisYear = yearOf(lagosMonth())
    const [openAlert, payments] = await Promise.all([
        getOpenAlertForUnit(actorFromUser(user), estateId, home.unit.id),
        listUnitPayments(actorFromUser(user), estateId, home.unit.id),
    ])

    return (
        <>
            <AppHeader user={user} />
            <main className='mx-auto max-w-3xl space-y-6 px-4 py-6'>
                <PageHeader back={{ href: '/app', label: 'Home' }} title={<>{home.unit.label}, {home.zone.name}</>} description={home.estateName} />

                {openAlert
                    ? (
                        <Link href={`/home/${occupancyId}/emergency/${openAlert.id}`} className='card flex items-center gap-3 border-red-300 bg-red-50 text-red-800'>
                            <Siren className='h-7 w-7 animate-pulse' aria-hidden />
                            <span><span className='block font-bold'>Emergency alert in progress</span><span className='text-sm'>Tap to see who is responding and call the police</span></span>
                        </Link>
                    )
                    : <DistressButton occupancyId={occupancyId} />}

                <ActionTile href={`/home/${occupancyId}/passes`} icon={QrCode} title='Visitor passes' description='Create a gate code for a visitor and share it' tone='accent' />

                <SectionCard title='Payments' icon={Receipt}
                    actions={<Link href={`/home/${occupancyId}/payments`} className='text-sm font-medium text-brand-700 hover:underline'>Totals by month & year</Link>}>
                    <div className='grid grid-cols-2 gap-3'>
                        {payments.current.map(c => (
                            <Link key={c.kind} href={`/home/${occupancyId}/payments`} className='rounded-xl bg-slate-50 p-3 hover:bg-slate-100'>
                                <p className='text-xs font-medium text-slate-500'>{CHARGE_KIND_LABEL[c.kind]} · {c.period.label}</p>
                                <p className='text-lg font-bold'>{formatNaira(c.paidKobo)}</p>
                                <Badge tone={c.state === 'paid' ? 'green' : c.state === 'part_paid' ? 'amber' : 'red'}>{PAYMENT_STATE_LABEL[c.state]}{c.outstandingKobo > 0 && c.state !== 'paid' ? `: ${formatNaira(c.outstandingKobo)} to pay` : ''}</Badge>
                            </Link>
                        ))}
                    </div>
                    <p className='mt-3 text-sm text-slate-600'>Paid {thisYear}: <span className='font-semibold'>{formatNaira(payments.byYear.find(y => y.year === thisYear)?.totalKobo ?? 0)}</span> · All time: <span className='font-semibold'>{formatNaira(payments.securityKobo + payments.serviceKobo)}</span></p>
                    <ul className='mt-2 divide-y divide-slate-100'>
                        {payments.rows.filter(p => !p.voidedAt).slice(0, 3).map(p => (
                            <li key={p.id} className='flex items-center justify-between gap-3 py-2 text-sm'>
                                <span><span className='font-medium'>{CHARGE_KIND_LABEL[p.kind]}</span> · {p.period}<span className='block text-xs text-slate-500'>Paid {formatDate(new Date(p.paidOn))}</span></span>
                                <span className='font-semibold'>{formatNaira(p.amountKobo)}</span>
                            </li>
                        ))}
                        {payments.rows.length === 0 && <li className='py-2 text-sm text-slate-500'>No payments recorded yet. If you have paid, send your receipt to the estate office.</li>}
                    </ul>
                </SectionCard>

                <SectionCard title='Household' icon={Users} description='To add or remove household members, contact your estate office.'>
                    <ul className='space-y-2'>
                        {home.household.map(h => (
                            <li key={h.id} className='flex items-center gap-3'>
                                <Avatar name={h.name} size='sm' />
                                <span className='font-medium'>{h.name}</span>
                                <span className='text-sm text-slate-500'>{RELATION[h.relation]}</span>
                                {h.isPrimary && <Badge tone='green'>Primary contact</Badge>}
                            </li>
                        ))}
                    </ul>
                </SectionCard>

                <SectionCard title='Vehicles' icon={Car}>
                    <ul className='divide-y divide-slate-100'>
                        {home.vehicles.map(v => (
                            <li key={v.id} className='flex items-center justify-between py-2 text-sm'>
                                <span><span className='rounded bg-slate-100 px-2 py-0.5 font-mono font-semibold'>{v.plate}</span> <span className='text-slate-600'>{[v.colour, v.make].filter(Boolean).join(' ')}</span></span>
                                <ActionForm action={removeMyVehicleAction.bind(null, occupancyId, v.id)}><button className='text-sm font-medium text-red-600 hover:underline'>Remove</button></ActionForm>
                            </li>
                        ))}
                        {home.vehicles.length === 0 && <li className='py-2 text-sm text-slate-500'>None registered.</li>}
                    </ul>
                    <ActionForm action={addMyVehicleAction.bind(null, occupancyId)} className='mt-4 grid grid-cols-3 gap-2'>
                        <Field label='Plate' name='plate'><input id='plate' name='plate' placeholder='ABC-123DE' required className='uppercase' /></Field>
                        <Field label='Make' name='make'><input id='make' name='make' placeholder='Toyota' /></Field>
                        <Field label='Colour' name='colour'><input id='colour' name='colour' placeholder='Black' /></Field>
                        <div className='col-span-3'><SubmitButton variant='secondary'>Add vehicle</SubmitButton></div>
                    </ActionForm>
                </SectionCard>

                <SectionCard title='Domestic staff & regular visitors' icon={Wrench}>
                    <ul className='divide-y divide-slate-100'>
                        {home.helpers.map(h => (
                            <li key={h.id} className='flex items-center justify-between py-2 text-sm'>
                                <span>{h.name} <span className='capitalize text-slate-500'>· {h.role}</span>{h.phone ? <span className='text-slate-500'> · {formatNigerianPhone(h.phone)}</span> : ''}</span>
                                <ActionForm action={removeMyHelperAction.bind(null, occupancyId, h.id)}><button className='text-sm font-medium text-red-600 hover:underline'>Remove</button></ActionForm>
                            </li>
                        ))}
                        {home.helpers.length === 0 && <li className='py-2 text-sm text-slate-500'>None registered.</li>}
                    </ul>
                    <ActionForm action={addMyHelperAction.bind(null, occupancyId)} className='mt-4 grid grid-cols-2 gap-2'>
                        <Field label='Name' name='name'><input id='name' name='name' required /></Field>
                        <Field label='Role' name='role'>
                            <select id='role' name='role' defaultValue='other' className='capitalize'>
                                {helperRole.enumValues.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </Field>
                        <div className='col-span-2'><Field label='Phone (optional)' name='phone'><PhoneInput name='phone' required={false} /></Field></div>
                        <div className='col-span-2'><SubmitButton variant='secondary'>Add</SubmitButton></div>
                    </ActionForm>
                </SectionCard>
            </main>
        </>
    )
}
