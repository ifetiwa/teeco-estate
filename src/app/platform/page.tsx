import { Banknote, Building2, CheckCircle2, Eye, House, MapPin, Phone, PlusCircle, ShieldAlert, Siren, Users } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ActionForm, Field, SubmitButton } from '@/components/ActionForm'
import { AppHeader } from '@/components/AppHeader'
import { AutoRefresh } from '@/components/AutoRefresh'
import { PhoneInput } from '@/components/PhoneInput'
import { Badge, type BadgeTone, PageHeader, SectionCard, StatCard } from '@/components/ui'
import { actorFromUser } from '@/lib/access'
import { requireUser } from '@/lib/auth/current'
import { DISTRESS_STATUS_LABEL, formatDialNumber, listPlatformAlerts, listPoliceStations } from '@/lib/emergency'
import { listAllEstates, listMyEstates } from '@/lib/estates'
import { formatDate, formatDateTime, formatNaira } from '@/lib/format'
import { formatNigerianPhone } from '@/lib/phone'

import { addPoliceStationAction, createEstateAction, openSupportAccessAction, setPoliceStationActiveAction, setPoliceStationVerifiedAction } from './actions'

export const metadata: Metadata = { title: 'Super admin' }
export const dynamic = 'force-dynamic'

const ALERT_TONE: Record<string, BadgeTone> = { active: 'red', acknowledged: 'amber', resolved: 'green', false_alarm: 'slate' }

/** The Teeco super admin dashboard: every estate at a glance, SOS alerts across all estates, and the police directory. */
export default async function PlatformPage () {
    const user = await requireUser()
    if (!user.isPlatformAdmin) notFound()
    const actor = actorFromUser(user)
    const [estates, mine, stations, alerts] = await Promise.all([listAllEstates(actor), listMyEstates(actor), listPoliceStations(actor), listPlatformAlerts(actor, 30)])
    const managedIds = new Set(mine.filter(m => m.staffRoles.length > 0).map(m => m.id))
    const totals = estates.reduce((t, e) => ({
        units: t.units + e.unitCount, residents: t.residents + e.residentCount, collected: t.collected + e.collectedThisMonthKobo, alerts: t.alerts + e.alertsThisMonth,
    }), { units: 0, residents: 0, collected: 0, alerts: 0 })
    const openAlerts = alerts.filter(a => a.alert.status === 'active' || a.alert.status === 'acknowledged')
    const recentAlerts = alerts.filter(a => !openAlerts.includes(a)).slice(0, 10)
    const unverified = stations.filter(s => s.isActive && !s.verifiedAt).length

    return (
        <>
            <AppHeader user={user} />
            <AutoRefresh seconds={30} />
            <main className='mx-auto max-w-7xl space-y-8 px-4 py-8'>
                <PageHeader title='Super admin' description='Every estate on Teeco, SOS alerts across all of them, and the police directory.' />

                <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5'>
                    <StatCard label='Estates' value={estates.length} icon={Building2} />
                    <StatCard label='Units' value={totals.units} icon={House} tone='slate' />
                    <StatCard label='Residents' value={totals.residents} icon={Users} tone='slate' />
                    <StatCard label='Received this month' value={formatNaira(totals.collected)} icon={Banknote} tone='accent' hint='Levies and service charges, all estates' />
                    <StatCard label='Open emergencies' value={openAlerts.length} icon={Siren} tone={openAlerts.length ? 'red' : 'slate'} hint={`${totals.alerts} alerts this month`} />
                </div>

                <section id='emergencies' className='scroll-mt-20 space-y-3'>
                    <h2 className='flex items-center gap-2 text-lg font-semibold'><Siren className='h-5 w-5 text-red-600' aria-hidden /> Emergencies</h2>
                    {openAlerts.length === 0
                        ? <p className='flex items-center gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm font-medium text-brand-800 ring-1 ring-brand-200'><CheckCircle2 className='h-5 w-5' aria-hidden /> No open emergencies in any estate.</p>
                        : openAlerts.map(a => (
                            <div key={a.alert.id} className='rounded-2xl border-2 border-red-500 bg-red-50 p-4'>
                                <p className='text-xs font-bold tracking-wider text-red-600 uppercase'>{a.estateName} · {DISTRESS_STATUS_LABEL[a.alert.status]}</p>
                                <p className='text-xl font-extrabold text-red-900'>{a.unitLabel}, {a.zoneName}</p>
                                <p className='text-sm text-red-800'>{a.address}</p>
                                <p className='text-sm text-red-800'>{a.raisedByName} · raised {formatDateTime(a.alert.createdAt)}</p>
                                <div className='mt-3 flex flex-wrap gap-2'>
                                    <a href={a.mapLink} target='_blank' rel='noreferrer' className='btn-danger'><MapPin className='h-4 w-4' aria-hidden /> Map</a>
                                    <a href={`tel:${a.raisedByPhone}`} className='btn-secondary'><Phone className='h-4 w-4' aria-hidden /> {formatNigerianPhone(a.raisedByPhone)}</a>
                                </div>
                            </div>
                        ))}
                    {recentAlerts.length > 0 && (
                        <details className='card p-4'>
                            <summary className='cursor-pointer text-sm font-semibold'>Recent closed alerts ({recentAlerts.length})</summary>
                            <ul className='mt-3 divide-y divide-slate-100 text-sm'>
                                {recentAlerts.map(a => (
                                    <li key={a.alert.id} className='flex flex-wrap items-center justify-between gap-2 py-2'>
                                        <span><span className='font-medium'>{a.estateName}</span> · {a.unitLabel}, {a.zoneName} · {formatDateTime(a.alert.createdAt)}<span className='block text-xs text-slate-500'>{a.alert.closingNote}</span></span>
                                        <Badge tone={ALERT_TONE[a.alert.status]}>{DISTRESS_STATUS_LABEL[a.alert.status]}</Badge>
                                    </li>
                                ))}
                            </ul>
                        </details>
                    )}
                </section>

                <div className='grid grid-cols-1 gap-8 2xl:grid-cols-[minmax(0,1fr)_380px]'>
                    <section>
                        <h2 className='mb-3 text-lg font-semibold'>Estates</h2>
                        <div className='table-wrap'>
                            <table className='data-table'>
                                <thead>
                                    <tr><th>Estate</th><th className='text-right'>Units</th><th className='text-right'>Residents</th><th className='text-right'>Guards</th><th className='text-right'>This month</th><th>SOS</th><th>Police division</th><th>Status</th><th>Access</th></tr>
                                </thead>
                                <tbody>
                                    {estates.map(e => (
                                        <tr key={e.id}>
                                            <td><span className='font-semibold'>{e.name}</span><span className='block text-xs text-slate-500'>{e.district} · since {formatDate(e.createdAt)}</span></td>
                                            <td className='text-right'>{e.unitCount}</td>
                                            <td className='text-right'>{e.residentCount}</td>
                                            <td className='text-right'>{e.guardCount || <span className='text-red-600'>0</span>}</td>
                                            <td className='text-right whitespace-nowrap'>{formatNaira(e.collectedThisMonthKobo)}</td>
                                            <td>{e.openAlerts > 0 ? <Badge tone='red'>{e.openAlerts} open</Badge> : <span className='text-xs text-slate-500'>{e.alertsThisMonth} this month</span>}</td>
                                            <td className='text-sm'>{e.policeStation ?? <span className='text-xs text-amber-700'>{e.hasLocation ? 'Not linked' : 'No location set'}</span>}</td>
                                            <td><Badge tone={e.status === 'active' ? 'green' : e.status === 'trial' ? 'amber' : 'red'}>{e.status}</Badge></td>
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
                                    {estates.length === 0 && <tr><td colSpan={9} className='text-slate-500'>No estates yet.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                        <p className='mt-2 text-xs text-slate-500'>Figures cover every estate. To see an estate&apos;s residents and records you don&apos;t manage, open it with a reason: access lasts 2 hours, is read-only and is logged for the estate admin.</p>
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

                <div id='police' className='grid scroll-mt-20 grid-cols-1 gap-8 2xl:grid-cols-[minmax(0,1fr)_380px]'>
                    <section>
                        <h2 className='mb-1 flex items-center gap-2 text-lg font-semibold'><ShieldAlert className='h-5 w-5 text-red-600' aria-hidden /> Police stations</h2>
                        <p className='mb-3 text-sm text-slate-600'>
                            Each estate is linked to its police division (set from the estate&apos;s map position; the estate admin can change it). An alert shows that division first, then the nearest others and the FCT Command lines.
                            {unverified > 0 && <> <span className='font-semibold text-amber-700'>{unverified} numbers have not been confirmed by phone yet.</span> Call each one and mark it confirmed.</>}
                        </p>
                        <div className='table-wrap'>
                            <table className='data-table'>
                                <thead><tr><th>Station</th><th>Phone</th><th>Source</th><th>Confirmed</th><th /></tr></thead>
                                <tbody>
                                    {stations.map(st => (
                                        <tr key={st.id} className={st.isActive ? '' : 'text-slate-400'}>
                                            <td><span className='font-semibold'>{st.name}</span><span className='block text-xs text-slate-500'>{[st.area, st.address].filter(Boolean).join(' · ')}</span></td>
                                            <td className='font-mono text-sm whitespace-nowrap'>
                                                {st.phone ? formatDialNumber(st.phone) : <span className='font-sans text-xs text-slate-500'>No direct line</span>}
                                                {st.altPhone && <span className='block'>{formatDialNumber(st.altPhone)}</span>}
                                            </td>
                                            <td className='max-w-64 text-xs text-slate-500'>{st.source}</td>
                                            <td>
                                                <ActionForm action={setPoliceStationVerifiedAction.bind(null, st.id, !st.verifiedAt)}>
                                                    {st.verifiedAt
                                                        ? <button className='text-left text-xs'><Badge tone='green'>Confirmed</Badge><span className='block text-slate-500'>{formatDate(st.verifiedAt)}</span></button>
                                                        : <button className='text-sm font-medium whitespace-nowrap text-brand-700 hover:underline' disabled={!st.phone}>{st.phone ? 'Mark confirmed' : ''}</button>}
                                                </ActionForm>
                                            </td>
                                            <td>
                                                <ActionForm action={setPoliceStationActiveAction.bind(null, st.id, !st.isActive)}>
                                                    <button className='text-sm font-medium text-brand-700 hover:underline'>{st.isActive ? 'Hide' : 'Show'}</button>
                                                </ActionForm>
                                            </td>
                                        </tr>
                                    ))}
                                    {stations.length === 0 && <tr><td colSpan={5} className='text-slate-500'>No stations yet. Until you add some, alerts show only the FCT Command lines, 112 and 199.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </section>

                    <SectionCard title='Add a police station' icon={PlusCircle} className='h-fit'>
                        <ActionForm action={addPoliceStationAction} className='flex flex-col gap-3'>
                            <Field label='Station name' name='name'><input id='ps-name' name='name' placeholder='e.g. Byazhin Police Division' required /></Field>
                            <Field label='Area' name='area'><input id='ps-area' name='area' placeholder='e.g. Kubwa' /></Field>
                            <Field label='Address' name='address'><input id='ps-address' name='address' /></Field>
                            <div className='grid grid-cols-2 gap-3'>
                                <Field label='Phone' name='phone' hint='Leave empty if none is published'><input id='ps-phone' name='phone' inputMode='tel' /></Field>
                                <Field label='Other phone' name='altPhone'><input id='ps-alt' name='altPhone' inputMode='tel' /></Field>
                                <Field label='Latitude' name='latitude'><input id='ps-lat' name='latitude' inputMode='decimal' placeholder='9.0579' required /></Field>
                                <Field label='Longitude' name='longitude'><input id='ps-lng' name='longitude' inputMode='decimal' placeholder='7.4951' required /></Field>
                            </div>
                            <Field label='Source' name='source' hint='Where the number came from'><input id='ps-source' name='source' placeholder='e.g. Called the station, 19 Oct 2026' /></Field>
                            <SubmitButton>Add station</SubmitButton>
                        </ActionForm>
                    </SectionCard>
                </div>
            </main>
        </>
    )
}
