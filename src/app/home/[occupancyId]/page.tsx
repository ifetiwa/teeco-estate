import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ActionForm, Field, SubmitButton } from '@/components/ActionForm'
import { AppHeader } from '@/components/AppHeader'
import { PhoneInput } from '@/components/PhoneInput'
import { helperRole } from '@/db/schema'
import { actorFromUser } from '@/lib/access'
import { requireUser } from '@/lib/auth/current'
import { NotFoundError } from '@/lib/errors'
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

    return (
        <>
            <AppHeader user={user} />
            <main className='mx-auto max-w-3xl space-y-6 px-4 py-6'>
                <div>
                    <Link href='/app' className='text-sm text-brand-700 underline'>← Home</Link>
                    <h1 className='mt-2 text-xl font-semibold'>{home.unit.label}, {home.zone.name}</h1>
                    <p className='text-slate-600'>{home.estateName}</p>
                </div>

                <section className='card'>
                    <h2 className='font-semibold'>Household</h2>
                    <ul className='mt-2 space-y-1 text-sm'>
                        {home.household.map(h => (
                            <li key={h.id}>{h.name} · {RELATION[h.relation]}{h.isPrimary ? ' · Primary contact' : ''}</li>
                        ))}
                    </ul>
                    <p className='mt-2 text-xs text-slate-500'>To add or remove household members, contact your estate office.</p>
                </section>

                <section className='card'>
                    <h2 className='font-semibold'>Vehicles</h2>
                    <ul className='mt-2 divide-y divide-slate-100'>
                        {home.vehicles.map(v => (
                            <li key={v.id} className='flex items-center justify-between py-2 text-sm'>
                                <span><span className='font-mono font-medium'>{v.plate}</span> {[v.colour, v.make].filter(Boolean).join(' ')}</span>
                                <ActionForm action={removeMyVehicleAction.bind(null, occupancyId, v.id)}><button className='text-red-700 underline'>Remove</button></ActionForm>
                            </li>
                        ))}
                        {home.vehicles.length === 0 && <li className='py-2 text-sm text-slate-600'>None registered.</li>}
                    </ul>
                    <ActionForm action={addMyVehicleAction.bind(null, occupancyId)} className='mt-3 grid grid-cols-3 gap-2'>
                        <Field label='Plate' name='plate'><input id='plate' name='plate' placeholder='ABC-123DE' required className='uppercase' /></Field>
                        <Field label='Make' name='make'><input id='make' name='make' placeholder='Toyota' /></Field>
                        <Field label='Colour' name='colour'><input id='colour' name='colour' placeholder='Black' /></Field>
                        <div className='col-span-3'><SubmitButton variant='secondary'>Add vehicle</SubmitButton></div>
                    </ActionForm>
                </section>

                <section className='card'>
                    <h2 className='font-semibold'>Domestic staff & regular visitors</h2>
                    <ul className='mt-2 divide-y divide-slate-100'>
                        {home.helpers.map(h => (
                            <li key={h.id} className='flex items-center justify-between py-2 text-sm'>
                                <span>{h.name} <span className='capitalize text-slate-500'>· {h.role}</span>{h.phone ? ` · ${formatNigerianPhone(h.phone)}` : ''}</span>
                                <ActionForm action={removeMyHelperAction.bind(null, occupancyId, h.id)}><button className='text-red-700 underline'>Remove</button></ActionForm>
                            </li>
                        ))}
                        {home.helpers.length === 0 && <li className='py-2 text-sm text-slate-600'>None registered.</li>}
                    </ul>
                    <ActionForm action={addMyHelperAction.bind(null, occupancyId)} className='mt-3 grid grid-cols-2 gap-2'>
                        <Field label='Name' name='name'><input id='name' name='name' required /></Field>
                        <Field label='Role' name='role'>
                            <select id='role' name='role' defaultValue='other' className='capitalize'>
                                {helperRole.enumValues.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </Field>
                        <div className='col-span-2'><Field label='Phone (optional)' name='phone'><PhoneInput name='phone' required={false} /></Field></div>
                        <div className='col-span-2'><SubmitButton variant='secondary'>Add</SubmitButton></div>
                    </ActionForm>
                </section>
            </main>
        </>
    )
}
