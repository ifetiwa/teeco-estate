import { Building2, Eye, House, PlusCircle, Users } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ActionForm, Field, SubmitButton } from '@/components/ActionForm'
import { AppHeader } from '@/components/AppHeader'
import { PhoneInput } from '@/components/PhoneInput'
import { Badge, PageHeader, SectionCard, StatCard } from '@/components/ui'
import { actorFromUser } from '@/lib/access'
import { requireUser } from '@/lib/auth/current'
import { listAllEstates, listMyEstates } from '@/lib/estates'
import { formatDate } from '@/lib/format'

import { createEstateAction, openSupportAccessAction } from './actions'

export const metadata: Metadata = { title: 'Platform' }

export default async function PlatformPage () {
    const user = await requireUser()
    if (!user.isPlatformAdmin) notFound()
    const actor = actorFromUser(user)
    const [estates, mine] = await Promise.all([listAllEstates(actor), listMyEstates(actor)])
    const managedIds = new Set(mine.filter(m => m.staffRoles.length > 0).map(m => m.id))
    const totals = estates.reduce((t, e) => ({ units: t.units + e.unitCount, residents: t.residents + e.residentCount }), { units: 0, residents: 0 })

    return (
        <>
            <AppHeader user={user} />
            <main className='mx-auto max-w-6xl px-4 py-8'>
                <PageHeader title='Teeco platform' description='Estates on the platform. Resident data stays private to each estate.' />
                <div className='grid gap-4 sm:grid-cols-3'>
                    <StatCard label='Estates' value={estates.length} icon={Building2} />
                    <StatCard label='Units' value={totals.units} icon={House} tone='accent' />
                    <StatCard label='Residents' value={totals.residents} icon={Users} tone='slate' />
                </div>

                <div className='mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_380px]'>
                    <section>
                        <h2 className='mb-3 text-lg font-semibold'>Estates</h2>
                        <div className='table-wrap'>
                            <table className='data-table'>
                                <thead>
                                    <tr><th>Estate</th><th>Units</th><th>Residents</th><th>Status</th><th>Created</th><th>Access</th></tr>
                                </thead>
                                <tbody>
                                    {estates.map(e => (
                                        <tr key={e.id}>
                                            <td><span className='font-semibold'>{e.name}</span><span className='block text-xs text-slate-500'>{e.district}</span></td>
                                            <td>{e.unitCount}</td>
                                            <td>{e.residentCount}</td>
                                            <td><Badge tone={e.status === 'active' ? 'green' : e.status === 'trial' ? 'amber' : 'red'}>{e.status}</Badge></td>
                                            <td className='whitespace-nowrap'>{formatDate(e.createdAt)}</td>
                                            <td>
                                                {managedIds.has(e.id)
                                                    ? <Link href={`/estate/${e.id}`} className='btn-secondary px-3 py-1.5 whitespace-nowrap'>Open as admin</Link>
                                                    : (
                                                        <ActionForm action={openSupportAccessAction.bind(null, e.id)} className='flex gap-2'>
                                                            <input name='reason' required minLength={10} placeholder='Reason (logged)' aria-label={`Reason for support access to ${e.name}`} className='w-40 py-1.5 text-sm' />
                                                            <SubmitButton variant='secondary' className='px-3 py-1.5'><Eye className='h-4 w-4' aria-hidden />Open</SubmitButton>
                                                        </ActionForm>
                                                    )}
                                            </td>
                                        </tr>
                                    ))}
                                    {estates.length === 0 && <tr><td colSpan={6} className='text-slate-500'>No estates yet.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                        <p className='mt-2 text-xs text-slate-500'>Platform admins see counts only. Opening an estate you don&apos;t manage needs a reason, lasts 2 hours, is read-only and is logged for the estate admin.</p>
                    </section>

                    <SectionCard title='New estate' icon={PlusCircle} className='h-fit'>
                        <ActionForm action={createEstateAction} className='flex flex-col gap-3'>
                            <Field label='Estate name' name='name'><input id='name' name='name' required /></Field>
                            <Field label='Street address' name='street'><input id='street' name='street' placeholder='e.g. Plot 123, Ahmadu Bello Way' /></Field>
                            <Field label='District' name='district'><input id='district' name='district' placeholder='e.g. Lokogoma' /></Field>
                            <div className='grid grid-cols-2 gap-3'>
                                <Field label='City' name='city'><input id='city' name='city' defaultValue='Abuja' required /></Field>
                                <Field label='State' name='state'><input id='state' name='state' defaultValue='FCT' required /></Field>
                            </div>
                            <Field label='Number of gates' name='gateCount'><input id='gateCount' name='gateCount' type='number' min={1} max={20} defaultValue={1} required /></Field>
                            <Field label='Estate office phone (optional)' name='contactPhone'><PhoneInput name='contactPhone' required={false} /></Field>
                            <Field label='Estate office email (optional)' name='contactEmail'><input id='contactEmail' name='contactEmail' type='email' /></Field>
                            <hr className='my-1 border-slate-200' />
                            <Field label='Estate admin / chairman name' name='adminName'><input id='adminName' name='adminName' required /></Field>
                            <Field label='Estate admin phone' name='adminPhone'><PhoneInput name='adminPhone' /></Field>
                            <SubmitButton className='w-full py-3'>Create estate</SubmitButton>
                        </ActionForm>
                    </SectionCard>
                </div>
            </main>
        </>
    )
}
