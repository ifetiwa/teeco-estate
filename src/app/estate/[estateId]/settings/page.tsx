import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ActionForm, Field, SubmitButton } from '@/components/ActionForm'
import { PhoneInput } from '@/components/PhoneInput'

import { regenerateJoinCodeAction, updateEstateAction, uploadLogoAction } from '../actions'
import { loadStaffEstate } from '../context'

export const metadata: Metadata = { title: 'Estate settings' }

export default async function SettingsPage ({ params }: { params: Promise<{ estateId: string }> }) {
    const { estateId } = await params
    const { estate, isAdmin } = await loadStaffEstate(estateId)
    if (!isAdmin) notFound()

    return (
        <div className='grid gap-6 lg:grid-cols-[1fr_320px]'>
            <section className='card'>
                <h1 className='text-xl font-semibold'>Estate details</h1>
                <ActionForm action={updateEstateAction.bind(null, estate.id)} className='mt-4 grid gap-3 sm:grid-cols-2' resetOnSuccess={false}>
                    <div className='sm:col-span-2'><Field label='Estate name' name='name'><input id='name' name='name' defaultValue={estate.name} required /></Field></div>
                    <div className='sm:col-span-2'><Field label='Street address' name='street'><input id='street' name='street' defaultValue={estate.street} /></Field></div>
                    <Field label='District' name='district'><input id='district' name='district' defaultValue={estate.district} /></Field>
                    <Field label='Number of gates' name='gateCount'><input id='gateCount' name='gateCount' type='number' min={1} max={20} defaultValue={estate.gateCount} required /></Field>
                    <Field label='City' name='city'><input id='city' name='city' defaultValue={estate.city} required /></Field>
                    <Field label='State' name='state'><input id='state' name='state' defaultValue={estate.state} required /></Field>
                    <Field label='Office phone' name='contactPhone'><PhoneInput name='contactPhone' defaultValue={estate.contactPhone ?? ''} required={false} /></Field>
                    <Field label='Office email' name='contactEmail'><input id='contactEmail' name='contactEmail' type='email' defaultValue={estate.contactEmail ?? ''} /></Field>
                    <div className='sm:col-span-2'><SubmitButton>Save</SubmitButton></div>
                </ActionForm>
            </section>
            <aside className='space-y-4'>
                <section className='card'>
                    <h2 className='font-semibold'>Logo</h2>
                    {estate.logoPath
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={`/files/${estate.logoPath}`} alt={`${estate.name} logo`} className='mt-3 h-20 w-20 rounded object-contain' />
                        : <p className='mt-2 text-sm text-slate-600'>No logo yet.</p>}
                    <ActionForm action={uploadLogoAction.bind(null, estate.id)} className='mt-3 flex flex-col gap-2'>
                        <input type='file' name='logo' accept='image/png,image/jpeg,image/webp' required className='text-sm' />
                        <p className='text-xs text-slate-500'>PNG, JPEG or WebP, up to 1 MB.</p>
                        <SubmitButton variant='secondary'>Upload</SubmitButton>
                    </ActionForm>
                </section>
                <section className='card'>
                    <h2 className='font-semibold'>Join code</h2>
                    <p className='mt-2 font-mono text-2xl tracking-[0.3em] text-brand-800'>{estate.joinCode}</p>
                    <ActionForm action={regenerateJoinCodeAction.bind(null, estate.id)} confirm='Make a new join code? The current code will stop working.' className='mt-3'>
                        <SubmitButton variant='secondary'>Make a new code</SubmitButton>
                    </ActionForm>
                </section>
            </aside>
        </div>
    )
}
