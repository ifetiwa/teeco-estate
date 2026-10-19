import { Building2, Image as ImageIcon, KeyRound, MapPin, ShieldCheck } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ActionForm, Field, SubmitButton } from '@/components/ActionForm'
import { PhoneInput } from '@/components/PhoneInput'
import { Badge, PageHeader, SectionCard } from '@/components/ui'
import { formatDateTime } from '@/lib/format'
import { formatNigerianPhone } from '@/lib/phone'
import { getEstatePolice } from '@/lib/emergency'
import { listSupportGrants } from '@/lib/support'

import { regenerateJoinCodeAction, setEstateLocationAction, setEstatePoliceStationAction, updateEstateAction, uploadLogoAction } from '../actions'
import { loadStaffEstate } from '../context'

export const metadata: Metadata = { title: 'Estate settings' }

export default async function SettingsPage ({ params }: { params: Promise<{ estateId: string }> }) {
    const { estateId } = await params
    const { actor, estate, can } = await loadStaffEstate(estateId)
    if (!can('estate.manage') && !can('audit.read')) notFound()
    const [grants, police] = await Promise.all([
        can('audit.read') ? listSupportGrants(actor, estate.id) : Promise.resolve([]),
        can('estate.manage') ? getEstatePolice(actor, estate.id) : Promise.resolve(null),
    ])
    const now = new Date()

    return (
        <div className='space-y-6'>
            <PageHeader title='Settings' description='Estate details, branding and access.' />
            {can('estate.manage') && (
                <div className='grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]'>
                    <SectionCard title='Estate details' icon={Building2}>
                        <ActionForm action={updateEstateAction.bind(null, estate.id)} className='grid gap-4 sm:grid-cols-2' resetOnSuccess={false}>
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
                    </SectionCard>
                    <div className='space-y-6'>
                        <SectionCard title='Logo' icon={ImageIcon}>
                            {estate.logoPath
                                // eslint-disable-next-line @next/next/no-img-element
                                ? <img src={`/files/${estate.logoPath}`} alt={`${estate.name} logo`} className='h-20 w-20 rounded-xl object-contain ring-1 ring-slate-200' />
                                : <p className='text-sm text-slate-500'>No logo yet.</p>}
                            <ActionForm action={uploadLogoAction.bind(null, estate.id)} className='mt-3 flex flex-col gap-2'>
                                <input type='file' name='logo' accept='image/png,image/jpeg,image/webp' required className='text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:font-semibold file:text-brand-700' />
                                <p className='text-xs text-slate-500'>PNG, JPEG or WebP, up to 1 MB.</p>
                                <SubmitButton variant='secondary'>Upload</SubmitButton>
                            </ActionForm>
                        </SectionCard>
                        <SectionCard title='Join code' icon={KeyRound}>
                            <p className='font-mono text-2xl font-bold tracking-[0.3em] text-brand-800'>{estate.joinCode}</p>
                            <ActionForm action={regenerateJoinCodeAction.bind(null, estate.id)} confirm='Make a new join code? The current code will stop working.' className='mt-3'>
                                <SubmitButton variant='secondary'>Make a new code</SubmitButton>
                            </ActionForm>
                        </SectionCard>
                    </div>
                </div>
            )}
            {can('estate.manage') && police && (
                <SectionCard title='Location and police division' icon={MapPin} description='Used for emergency alerts: the map position when a resident&apos;s phone has no GPS, and the police division shown first to call.'>
                    <div className='grid gap-6 lg:grid-cols-2'>
                        <div>
                            <ActionForm action={setEstateLocationAction.bind(null, estate.id)} className='grid gap-3 sm:grid-cols-2' resetOnSuccess={false}>
                                <Field label='Latitude' name='latitude'><input id='latitude' name='latitude' inputMode='decimal' placeholder='9.0579' defaultValue={estate.latitude ?? ''} /></Field>
                                <Field label='Longitude' name='longitude'><input id='longitude' name='longitude' inputMode='decimal' placeholder='7.4951' defaultValue={estate.longitude ?? ''} /></Field>
                                <div className='sm:col-span-2'><SubmitButton variant='secondary'>Save location</SubmitButton></div>
                            </ActionForm>
                            <p className='mt-2 text-xs text-slate-500'>In Google Maps, press and hold on the estate gate, then copy the two numbers shown (latitude first). Saving links the nearest police division if none is chosen yet.</p>
                        </div>
                        <div>
                            <ActionForm action={setEstatePoliceStationAction.bind(null, estate.id)} className='flex flex-col gap-3' resetOnSuccess={false}>
                                <Field label='Police division for this estate' name='stationId' hint='Pick the division that actually covers your street, e.g. Kubwa Arab Road: Byazhin.'>
                                    <select id='stationId' name='stationId' defaultValue={police.station?.id ?? ''}>
                                        <option value=''>Not set</option>
                                        {police.options.map(o => (
                                            <option key={o.id} value={o.id}>{o.name}{o.distanceKm !== null ? ` (${o.distanceKm.toFixed(1)} km)` : ''}{o.phone ? '' : ' · no direct line'}</option>
                                        ))}
                                    </select>
                                </Field>
                                <SubmitButton>Save police division</SubmitButton>
                            </ActionForm>
                        </div>
                    </div>
                </SectionCard>
            )}

            <SectionCard title='Teeco support access' icon={ShieldCheck}
                description='Teeco staff can only see your estate’s data after recording a reason. Access is read-only and ends after 2 hours.'>
                {grants.length === 0 && <p className='text-sm text-slate-500'>No support access so far.</p>}
                <ul className='divide-y divide-slate-100 text-sm'>
                    {grants.map(g => (
                        <li key={g.id} className='flex flex-wrap items-center gap-2 py-2'>
                            <span className='font-semibold'>{g.name || formatNigerianPhone(g.phone)}</span>
                            <span className='text-slate-500'>{formatDateTime(g.createdAt)}</span>
                            <span>{g.reason}</span>
                            {g.revokedAt ? <Badge>closed early</Badge> : g.expiresAt > now ? <Badge tone='amber'>active now</Badge> : null}
                        </li>
                    ))}
                </ul>
            </SectionCard>
        </div>
    )
}
