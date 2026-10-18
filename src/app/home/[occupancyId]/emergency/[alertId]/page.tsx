import { CheckCircle2, MapPin, Phone, ShieldAlert, Siren } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ActionForm, SubmitButton } from '@/components/ActionForm'
import { AppHeader } from '@/components/AppHeader'
import { Badge, PageHeader, SectionCard } from '@/components/ui'
import { actorFromUser } from '@/lib/access'
import { requireUser } from '@/lib/auth/current'
import { DISTRESS_STATUS_LABEL, formatDialNumber, getDistressForResident } from '@/lib/emergency'
import { NotFoundError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { getMyHome } from '@/lib/residents'

import { cancelDistressAction } from '../../actions'
import { AutoDial } from './AutoDial'

export const metadata: Metadata = { title: 'Emergency alert' }
export const dynamic = 'force-dynamic'

export default async function EmergencyAlertPage ({ params }: { params: Promise<{ occupancyId: string, alertId: string }> }) {
    const { occupancyId, alertId } = await params
    const user = await requireUser()
    const actor = actorFromUser(user)
    let home, screen
    try {
        home = await getMyHome(actor, occupancyId)
        screen = await getDistressForResident(actor, home.occupancy.estateId, alertId)
    } catch (e) {
        if (e instanceof NotFoundError || (e as { code?: string }).code === '22P02') notFound()
        throw e
    }
    const { alert, stations, emergencyLines } = screen
    const open = alert.status === 'active' || alert.status === 'acknowledged'
    const firstNumber = stations[0]?.phone ?? emergencyLines[0].number

    return (
        <>
            <AppHeader user={user} />
            <AutoDial alertId={alert.id} number={firstNumber} active={open} />
            <main className='mx-auto max-w-lg space-y-5 px-4 py-6'>
                <PageHeader back={{ href: `/home/${occupancyId}`, label: 'My home' }} title='Emergency alert' description={`${screen.house} · ${formatDateTime(alert.createdAt)}`} />

                <div className={`card ${open ? 'border-red-300 bg-red-50' : 'border-slate-200'}`}>
                    <div className='flex items-start gap-3'>
                        {alert.status === 'acknowledged'
                            ? <ShieldAlert className='h-8 w-8 shrink-0 text-accent-600' aria-hidden />
                            : open ? <Siren className='h-8 w-8 shrink-0 animate-pulse text-red-600' aria-hidden /> : <CheckCircle2 className='h-8 w-8 shrink-0 text-brand-600' aria-hidden />}
                        <div className='min-w-0'>
                            <p className='text-lg font-bold'>
                                {alert.status === 'active' && 'Alert sent. Estate security has been told.'}
                                {alert.status === 'acknowledged' && 'Security is on the way.'}
                                {!open && 'This alert is closed.'}
                            </p>
                            <p className='text-sm text-slate-600'>
                                {alert.notifiedCount} {alert.notifiedCount === 1 ? 'person' : 'people'} in the estate notified.{' '}
                                {alert.locationSource === 'gps' && `Your location was shared${alert.accuracyMeters ? ` (accurate to about ${alert.accuracyMeters} m)` : ''}.`}
                                {alert.locationSource === 'estate' && 'Your phone did not share its location, so the estate\'s location was used.'}
                                {alert.locationSource === 'none' && 'Your phone did not share its location; security has your house address.'}
                            </p>
                            <p className='mt-2'><Badge tone={open ? (alert.status === 'acknowledged' ? 'amber' : 'red') : 'slate'}>{DISTRESS_STATUS_LABEL[alert.status]}</Badge></p>
                            {alert.closingNote && <p className='mt-2 text-sm text-slate-600'>{alert.closingNote}</p>}
                        </div>
                    </div>
                </div>

                <SectionCard title='Call the police' icon={Phone} description={stations.length ? 'Nearest stations to you first. Tap to call.' : 'Tap to call.'}>
                    <ul className='space-y-2'>
                        {stations.map((s, i) => (
                            <li key={s.id}>
                                <a href={`tel:${s.phone}`} className={`flex items-center gap-3 rounded-xl px-4 py-3 ring-1 transition ${i === 0 ? 'bg-red-600 text-white ring-red-600 hover:bg-red-700' : 'bg-white ring-slate-200 hover:bg-slate-50'}`}>
                                    <Phone className='h-5 w-5 shrink-0' aria-hidden />
                                    <span className='min-w-0 flex-1'>
                                        <span className='block font-semibold'>{s.name}</span>
                                        <span className={`block text-sm ${i === 0 ? 'text-red-100' : 'text-slate-500'}`}>{[s.area, `${s.distanceKm.toFixed(1)} km away`].filter(Boolean).join(' · ')}</span>
                                    </span>
                                    <span className='font-mono text-sm font-semibold'>{formatDialNumber(s.phone)}</span>
                                </a>
                                {s.altPhone && <a href={`tel:${s.altPhone}`} className='mt-1 block pl-12 text-sm font-medium text-brand-700 hover:underline'>Other line: {formatDialNumber(s.altPhone)}</a>}
                            </li>
                        ))}
                        {emergencyLines.map((l, i) => (
                            <li key={l.number}>
                                <a href={`tel:${l.number}`} className={`flex items-center gap-3 rounded-xl px-4 py-3 ring-1 transition ${stations.length === 0 && i === 0 ? 'bg-red-600 text-white ring-red-600 hover:bg-red-700' : 'bg-white ring-slate-200 hover:bg-slate-50'}`}>
                                    <Phone className='h-5 w-5 shrink-0' aria-hidden />
                                    <span className='flex-1 font-semibold'>{l.label}</span>
                                    <span className='font-mono text-lg font-bold'>{l.number}</span>
                                </a>
                            </li>
                        ))}
                    </ul>
                </SectionCard>

                <SectionCard title='Your location' icon={MapPin}>
                    <p className='text-sm'>{screen.address}</p>
                    <a href={screen.mapLink} target='_blank' rel='noreferrer' className='btn-secondary mt-3 w-full'><MapPin className='h-4 w-4' aria-hidden /> Open in Google Maps</a>
                </SectionCard>

                {open && (
                    <ActionForm action={cancelDistressAction.bind(null, occupancyId, alert.id)} confirm='Cancel this alert? Security will be told it was a false alarm.'>
                        <SubmitButton variant='secondary' className='w-full'>It was a false alarm. Cancel the alert</SubmitButton>
                    </ActionForm>
                )}
            </main>
        </>
    )
}
