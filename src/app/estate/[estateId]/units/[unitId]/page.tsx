import { Car, History, UserPlus, Users, Wrench } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ActionForm, Field, SubmitButton } from '@/components/ActionForm'
import { PhoneInput } from '@/components/PhoneInput'
import { Avatar, Badge, EmptyState, PageHeader, SectionCard } from '@/components/ui'
import { helperRole } from '@/db/schema'
import { NotFoundError } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { formatNigerianPhone } from '@/lib/phone'
import { getUnitDetail } from '@/lib/structure'

import {
    addHelperAction, addResidentAction, addVehicleAction, moveOutAction, removeHelperAction, removeVehicleAction, setPrimaryAction, setUnitActiveAction,
} from '../../actions'
import { loadStaffEstate } from '../../context'

export const metadata: Metadata = { title: 'Unit' }

const RELATION: Record<string, string> = { owner: 'Owner', tenant: 'Tenant', household: 'Household' }

export default async function UnitPage ({ params }: { params: Promise<{ estateId: string, unitId: string }> }) {
    const { estateId, unitId } = await params
    const { actor, estate, isAdmin } = await loadStaffEstate(estateId)
    let detail
    try {
        detail = await getUnitDetail(actor, estate.id, unitId)
    } catch (e) {
        if (e instanceof NotFoundError || (e as { code?: string }).code === '22P02') notFound()
        throw e
    }
    const { unit, zone, occupants, vehicles, helpers } = detail
    const current = occupants.filter(o => o.status === 'active')
    const pending = occupants.filter(o => o.status === 'pending')
    const past = occupants.filter(o => o.status === 'moved_out')
    const today = new Date().toISOString().slice(0, 10)

    return (
        <div className='space-y-6'>
            <PageHeader
                back={{ href: `/estate/${estate.id}/units`, label: 'Streets & units' }}
                title={<>{unit.label}, {zone.name}</>}
                description={<span className='inline-flex items-center gap-2'><span className='capitalize'>{unit.type}</span>{!unit.isActive && <Badge tone='slate'>Inactive</Badge>}</span>}
                actions={isAdmin ? (
                    <ActionForm action={setUnitActiveAction.bind(null, estate.id, unit.id, !unit.isActive)} confirm={unit.isActive ? 'Deactivate this unit?' : undefined}>
                        <SubmitButton variant='secondary'>{unit.isActive ? 'Deactivate unit' : 'Reactivate unit'}</SubmitButton>
                    </ActionForm>
                ) : undefined}
            />

            <SectionCard title='Current residents' icon={Users} description={pending.length > 0 ? <>{pending.length} request{pending.length > 1 ? 's' : ''} waiting: see <Link className='font-medium text-accent-600 underline' href={`/estate/${estate.id}/residents#approvals`}>approvals</Link></> : undefined}>
                {current.length === 0 && <EmptyState icon={Users} title='Nobody lives here yet' />}
                <ul className='divide-y divide-slate-100'>
                    {current.map(o => (
                        <li key={o.id} className='flex flex-wrap items-center justify-between gap-3 py-3'>
                            <div className='flex min-w-0 items-center gap-3'>
                                <Avatar name={o.name} />
                                <div className='min-w-0'>
                                    <p className='flex flex-wrap items-center gap-2 font-semibold'>{o.name} {o.isPrimary && <span className='rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 ring-1 ring-brand-200'>Primary contact</span>}</p>
                                    <p className='text-sm text-slate-500'>
                                        {RELATION[o.relation]} · {formatNigerianPhone(o.phone)}{o.email ? ` · ${o.email}` : ''}{o.moveInDate ? ` · since ${formatDate(new Date(o.moveInDate))}` : ''}
                                    </p>
                                </div>
                            </div>
                            {isAdmin && (
                                <div className='flex flex-wrap items-end gap-2'>
                                    {!o.isPrimary && (
                                        <ActionForm action={setPrimaryAction.bind(null, estate.id, o.id)}>
                                            <SubmitButton variant='secondary' className='px-3 py-1.5'>Make primary</SubmitButton>
                                        </ActionForm>
                                    )}
                                    <ActionForm action={moveOutAction.bind(null, estate.id, o.id)} className='flex items-end gap-2' confirm={`Move out ${o.name}? Their access to the estate will end.`}>
                                        <input type='date' name='moveOutDate' defaultValue={today} aria-label='Move-out date' className='py-1.5 text-sm' />
                                        <SubmitButton variant='danger' className='px-3 py-1.5'>Move out</SubmitButton>
                                    </ActionForm>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            </SectionCard>

            {isAdmin && unit.isActive && (
                <SectionCard title='Add a resident' icon={UserPlus}>
                    <ActionForm action={addResidentAction.bind(null, estate.id)} className='grid gap-3 sm:grid-cols-2'>
                        <input type='hidden' name='unitId' value={unit.id} />
                        <Field label='Full name' name='name'><input id='name' name='name' required /></Field>
                        <Field label='Phone' name='phone'><PhoneInput name='phone' /></Field>
                        <Field label='Relation' name='relation'>
                            <select id='relation' name='relation' defaultValue='owner'>
                                <option value='owner'>Owner</option><option value='tenant'>Tenant</option><option value='household'>Household member</option>
                            </select>
                        </Field>
                        <Field label='Email (optional)' name='email'><input id='email' name='email' type='email' /></Field>
                        <Field label='Move-in date (optional)' name='moveInDate'><input id='moveInDate' name='moveInDate' type='date' /></Field>
                        <div className='flex items-end pb-2'><label className='flex items-center gap-2'><input type='checkbox' name='isPrimary' className='h-4 w-4' /> Make primary contact</label></div>
                        <div className='sm:col-span-2'><SubmitButton>Add resident</SubmitButton></div>
                    </ActionForm>
                </SectionCard>
            )}

            <div className='grid gap-6 md:grid-cols-2'>
                <SectionCard title='Vehicles' icon={Car}>
                    <ul className='divide-y divide-slate-100'>
                        {vehicles.map(v => (
                            <li key={v.id} className='flex items-center justify-between py-2 text-sm'>
                                <span><span className='rounded bg-slate-100 px-2 py-0.5 font-mono font-semibold'>{v.plate}</span> <span className='text-slate-600'>{[v.colour, v.make].filter(Boolean).join(' ')}</span></span>
                                {isAdmin && <ActionForm action={removeVehicleAction.bind(null, estate.id, v.id)}><button className='text-sm font-medium text-red-600 hover:underline'>Remove</button></ActionForm>}
                            </li>
                        ))}
                        {vehicles.length === 0 && <li className='py-2 text-sm text-slate-500'>None registered.</li>}
                    </ul>
                    {isAdmin && current.length > 0 && (
                        <ActionForm action={addVehicleAction.bind(null, estate.id)} className='mt-4 grid grid-cols-3 gap-2'>
                            <input type='hidden' name='unitId' value={unit.id} />
                            <Field label='Plate' name='plate'><input id='plate' name='plate' placeholder='ABC-123DE' required className='uppercase' /></Field>
                            <Field label='Make' name='make'><input id='make' name='make' placeholder='Toyota' /></Field>
                            <Field label='Colour' name='colour'><input id='colour' name='colour' placeholder='Black' /></Field>
                            <div className='col-span-3'><SubmitButton variant='secondary'>Add vehicle</SubmitButton></div>
                        </ActionForm>
                    )}
                </SectionCard>

                <SectionCard title='Domestic staff & regular visitors' icon={Wrench}>
                    <ul className='divide-y divide-slate-100'>
                        {helpers.map(h => (
                            <li key={h.id} className='flex items-center justify-between py-2 text-sm'>
                                <span>{h.name} <span className='capitalize text-slate-500'>· {h.role}</span>{h.phone ? <span className='text-slate-500'> · {formatNigerianPhone(h.phone)}</span> : ''}</span>
                                {isAdmin && <ActionForm action={removeHelperAction.bind(null, estate.id, h.id)}><button className='text-sm font-medium text-red-600 hover:underline'>Remove</button></ActionForm>}
                            </li>
                        ))}
                        {helpers.length === 0 && <li className='py-2 text-sm text-slate-500'>None registered.</li>}
                    </ul>
                    {isAdmin && current.length > 0 && (
                        <ActionForm action={addHelperAction.bind(null, estate.id)} className='mt-4 grid grid-cols-2 gap-2'>
                            <input type='hidden' name='unitId' value={unit.id} />
                            <Field label='Name' name='name'><input id='hname' name='name' required /></Field>
                            <Field label='Role' name='role'>
                                <select id='role' name='role' defaultValue='other' className='capitalize'>
                                    {helperRole.enumValues.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                            </Field>
                            <div className='col-span-2'><Field label='Phone (optional)' name='phone'><PhoneInput name='phone' required={false} /></Field></div>
                            <div className='col-span-2'><SubmitButton variant='secondary'>Add</SubmitButton></div>
                        </ActionForm>
                    )}
                </SectionCard>
            </div>

            {past.length > 0 && (
                <SectionCard title='Previous residents' icon={History}>
                    <ul className='space-y-1 text-sm text-slate-600'>
                        {past.map(o => (
                            <li key={o.id}>{o.name} · {RELATION[o.relation]} · {o.moveInDate ? formatDate(new Date(o.moveInDate)) : '?'} to {o.moveOutDate ? formatDate(new Date(o.moveOutDate)) : '?'}</li>
                        ))}
                    </ul>
                </SectionCard>
            )}
        </div>
    )
}
