import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ActionForm, Field, SubmitButton } from '@/components/ActionForm'
import { PhoneInput } from '@/components/PhoneInput'
import { formatDateTime } from '@/lib/format'
import { formatNigerianPhone } from '@/lib/phone'
import { listSupportGrants } from '@/lib/support'

import { regenerateJoinCodeAction, updateEstateAction, uploadLogoAction } from '../actions'
import { loadStaffEstate } from '../context'

export const metadata: Metadata = { title: 'Estate settings' }

export default async function SettingsPage ({ params }: { params: Promise<{ estateId: string }> }) {
    const { estateId } = await params
    const { actor, estate, can } = await loadStaffEstate(estateId)
    if (!can('estate.manage') && !can('audit.read')) notFound()
    const grants = can('audit.read') ? await listSupportGrants(actor, estate.id) : []

    return (
        <div className='space-y-6'>
        {can('estate.manage') && (
        <div className='grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]'>
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
        )}
        <section className='card'>
            <h2 className='font-semibold'>Teeco support access</h2>
            <p className='mt-1 text-sm text-slate-600'>Teeco staff can only see your estate's data after recording a reason. Access is read-only and ends after 2 hours.</p>
            {grants.length === 0 && <p className='mt-2 text-sm text-slate-600'>No support access so far.</p>}
            <ul className='mt-2 divide-y divide-slate-100 text-sm'>
                {grants.map(g => (
                    <li key={g.id} className='py-2'>
                        <span className='font-medium'>{g.name || formatNigerianPhone(g.phone)}</span> · {formatDateTime(g.createdAt)} · {g.reason}
                        {g.revokedAt ? ' · closed early' : g.expiresAt > new Date() ? ' · active now' : ''}
                    </li>
                ))}
            </ul>
        </section>
        </div>
    )
}
