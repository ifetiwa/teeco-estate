import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ActionForm, Field, SubmitButton } from '@/components/ActionForm'
import { AppHeader } from '@/components/AppHeader'
import { PhoneInput } from '@/components/PhoneInput'
import { actorFromUser } from '@/lib/access'
import { requireUser } from '@/lib/auth/current'
import { listAllEstates } from '@/lib/estates'
import { formatDate } from '@/lib/format'

import { createEstateAction } from './actions'

export const metadata: Metadata = { title: 'Platform' }

export default async function PlatformPage () {
    const user = await requireUser()
    if (!user.isPlatformAdmin) notFound()
    const estates = await listAllEstates(actorFromUser(user))

    return (
        <>
            <AppHeader user={user} />
            <main className='mx-auto grid max-w-5xl gap-8 px-4 py-6 lg:grid-cols-[1fr_380px]'>
                <section>
                    <h1 className='text-2xl font-semibold'>Estates</h1>
                    <div className='mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white'>
                        <table className='w-full text-left text-sm'>
                            <thead className='bg-slate-50 text-slate-600'>
                                <tr><th className='p-3'>Estate</th><th className='p-3'>District</th><th className='p-3'>Units</th><th className='p-3'>Status</th><th className='p-3'>Created</th></tr>
                            </thead>
                            <tbody>
                                {estates.map(e => (
                                    <tr key={e.id} className='border-t border-slate-100'>
                                        <td className='p-3 font-medium'>{e.name}</td>
                                        <td className='p-3'>{e.district}</td>
                                        <td className='p-3'>{e.unitCount}</td>
                                        <td className='p-3 capitalize'>{e.status}</td>
                                        <td className='p-3'>{formatDate(e.createdAt)}</td>
                                    </tr>
                                ))}
                                {estates.length === 0 && <tr><td colSpan={5} className='p-3 text-slate-500'>No estates yet.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                    <p className='mt-2 text-xs text-slate-500'>Resident data is private to each estate. Platform admins see counts only.</p>
                </section>
                <section className='card h-fit'>
                    <h2 className='text-lg font-semibold'>New estate</h2>
                    <ActionForm action={createEstateAction} className='mt-4 flex flex-col gap-3'>
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
                        <SubmitButton>Create estate</SubmitButton>
                    </ActionForm>
                </section>
            </main>
        </>
    )
}
