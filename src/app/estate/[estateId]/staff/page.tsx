import { Info, UserCog, UserPlus } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ActionForm, Field, SubmitButton } from '@/components/ActionForm'
import { PhoneInput } from '@/components/PhoneInput'
import { Avatar, Badge, PageHeader, SectionCard } from '@/components/ui'
import { formatNigerianPhone } from '@/lib/phone'
import { listStaff } from '@/lib/staff'

import { addStaffAction, removeStaffAction } from '../actions'
import { loadStaffEstate } from '../context'

export const metadata: Metadata = { title: 'Staff' }

const ROLE: Record<string, { label: string, desc: string, tone: 'green' | 'amber' | 'blue' }> = {
    estate_admin: { label: 'Estate admin', desc: 'Everything for this estate', tone: 'green' },
    finance_officer: { label: 'Finance officer', desc: 'Charges, payments, arrears and reports. No gate access.', tone: 'amber' },
    guard: { label: 'Guard', desc: 'Gate: visitor codes, check-in and out. Cannot see invoices or payments.', tone: 'blue' },
}

export default async function StaffPage ({ params }: { params: Promise<{ estateId: string }> }) {
    const { estateId } = await params
    const { actor, estate, can } = await loadStaffEstate(estateId)
    if (!can('staff.manage')) notFound()
    const staff = await listStaff(actor, estate.id)
    const active = staff.filter(s => s.isActive)

    return (
        <div>
            <PageHeader title={`Staff (${active.length})`} description='People who run the estate: admins, finance officers and guards.' />
            <div className='grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]'>
                <div className='space-y-4'>
                    <ul className='card divide-y divide-slate-100 p-0'>
                        {active.map(s => (
                            <li key={s.id} className='flex flex-wrap items-center justify-between gap-3 px-5 py-4'>
                                <div className='flex min-w-0 items-center gap-3'>
                                    <Avatar name={s.name || s.phone} />
                                    <div className='min-w-0'>
                                        <p className='font-semibold'>{s.name || formatNigerianPhone(s.phone)} {s.userId === actor.userId && <span className='text-xs font-normal text-slate-500'>(you)</span>}</p>
                                        <p className='flex flex-wrap items-center gap-2 text-sm text-slate-500'><Badge tone={ROLE[s.role].tone}>{ROLE[s.role].label}</Badge> {formatNigerianPhone(s.phone)}</p>
                                    </div>
                                </div>
                                <ActionForm action={removeStaffAction.bind(null, estate.id, s.id)} confirm={`Remove ${ROLE[s.role].label.toLowerCase()} role from ${s.name || 'this person'}?`}>
                                    <SubmitButton variant='secondary' className='px-3 py-1.5'>Remove</SubmitButton>
                                </ActionForm>
                            </li>
                        ))}
                    </ul>
                    <SectionCard title='What each role can do' icon={Info}>
                        <dl className='space-y-2 text-sm'>
                            {Object.values(ROLE).map(r => <div key={r.label} className='flex flex-wrap gap-2'><dt><Badge tone={r.tone}>{r.label}</Badge></dt> <dd className='text-slate-600'>{r.desc}</dd></div>)}
                        </dl>
                    </SectionCard>
                </div>
                <SectionCard title='Add staff' icon={UserPlus} className='h-fit'>
                    <ActionForm action={addStaffAction.bind(null, estate.id)} className='flex flex-col gap-3'>
                        <Field label='Name' name='name'><input id='name' name='name' required /></Field>
                        <Field label='Phone' name='phone'><PhoneInput name='phone' /></Field>
                        <Field label='Role' name='role'>
                            <select id='role' name='role' defaultValue='guard'>
                                {Object.entries(ROLE).map(([value, r]) => <option key={value} value={value}>{r.label}</option>)}
                            </select>
                        </Field>
                        <SubmitButton>Add</SubmitButton>
                        <p className='flex items-center gap-1.5 text-xs text-slate-500'><UserCog className='h-3.5 w-3.5' aria-hidden /> They sign in with this phone number.</p>
                    </ActionForm>
                </SectionCard>
            </div>
        </div>
    )
}
