import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ActionForm, Field, SubmitButton } from '@/components/ActionForm'
import { PhoneInput } from '@/components/PhoneInput'
import { formatNigerianPhone } from '@/lib/phone'
import { listStaff } from '@/lib/staff'

import { addStaffAction, removeStaffAction } from '../actions'
import { loadStaffEstate } from '../context'

export const metadata: Metadata = { title: 'Staff' }

const ROLE: Record<string, { label: string, desc: string }> = {
    estate_admin: { label: 'Estate admin', desc: 'Everything for this estate' },
    finance_officer: { label: 'Finance officer', desc: 'Charges, payments, arrears and reports. No gate access.' },
    guard: { label: 'Guard', desc: 'Gate: visitor codes, check-in and out. Cannot see invoices or payments.' },
}

export default async function StaffPage ({ params }: { params: Promise<{ estateId: string }> }) {
    const { estateId } = await params
    const { actor, estate, can } = await loadStaffEstate(estateId)
    if (!can('staff.manage')) notFound()
    const staff = await listStaff(actor, estate.id)
    const active = staff.filter(s => s.isActive)

    return (
        <div className='grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]'>
            <section>
                <h1 className='text-xl font-semibold'>Staff ({active.length})</h1>
                <ul className='mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white'>
                    {active.map(s => (
                        <li key={s.id} className='flex flex-wrap items-center justify-between gap-3 p-3'>
                            <div>
                                <p className='font-medium'>{s.name || formatNigerianPhone(s.phone)} {s.userId === actor.userId && <span className='text-xs text-slate-500'>(you)</span>}</p>
                                <p className='text-sm text-slate-600'>{ROLE[s.role].label} · {formatNigerianPhone(s.phone)}</p>
                            </div>
                            <ActionForm action={removeStaffAction.bind(null, estate.id, s.id)} confirm={`Remove ${ROLE[s.role].label.toLowerCase()} role from ${s.name || 'this person'}?`}>
                                <SubmitButton variant='secondary' className='px-3 py-1 text-sm'>Remove</SubmitButton>
                            </ActionForm>
                        </li>
                    ))}
                </ul>
                <dl className='mt-4 space-y-1 text-sm text-slate-600'>
                    {Object.values(ROLE).map(r => <div key={r.label}><dt className='inline font-medium'>{r.label}:</dt> <dd className='inline'>{r.desc}</dd></div>)}
                </dl>
            </section>
            <aside className='card h-fit'>
                <h2 className='font-semibold'>Add staff</h2>
                <ActionForm action={addStaffAction.bind(null, estate.id)} className='mt-3 flex flex-col gap-3'>
                    <Field label='Name' name='name'><input id='name' name='name' required /></Field>
                    <Field label='Phone' name='phone'><PhoneInput name='phone' /></Field>
                    <Field label='Role' name='role'>
                        <select id='role' name='role' defaultValue='guard'>
                            {Object.entries(ROLE).map(([value, r]) => <option key={value} value={value}>{r.label}</option>)}
                        </select>
                    </Field>
                    <SubmitButton>Add</SubmitButton>
                    <p className='text-xs text-slate-500'>They sign in with this phone number.</p>
                </ActionForm>
            </aside>
        </div>
    )
}
