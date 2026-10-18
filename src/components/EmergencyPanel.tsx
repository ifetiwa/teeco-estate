import { MapPin, Phone, Siren } from 'lucide-react'

import { ActionForm, SubmitButton } from '@/components/ActionForm'
import { AlarmSound } from '@/components/AlarmSound'
import type { ActionState } from '@/lib/actions'
import type { listOpenAlerts } from '@/lib/emergency'
import { formatTime } from '@/lib/format'
import { formatNigerianPhone } from '@/lib/phone'

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>

export interface PanelAlert {
    id: string
    status: 'active' | 'acknowledged' | 'resolved' | 'false_alarm'
    house: string
    address: string
    mapLink: string
    callerName: string
    callerPhone: string
    createdAt: Date
    locationSource: 'gps' | 'estate' | 'none'
    accuracyMeters: number | null
}

/** Flattens a listOpenAlerts/listAlerts row for the panel. */
export function toPanelAlert (r: Awaited<ReturnType<typeof listOpenAlerts>>[number]): PanelAlert {
    return {
        id: r.alert.id,
        status: r.alert.status,
        house: `${r.unitLabel}, ${r.zoneName}`,
        address: r.address,
        mapLink: r.mapLink,
        callerName: r.raisedByName,
        callerPhone: r.raisedByPhone,
        createdAt: r.alert.createdAt,
        locationSource: r.alert.locationSource,
        accuracyMeters: r.alert.accuracyMeters,
    }
}

/** Open distress alerts for guards and estate admins, with the location and respond/close controls. */
export function EmergencyPanel ({ alerts, acknowledge, resolve, readOnly = false }: {
    alerts: PanelAlert[]
    acknowledge: (alertId: string) => Action
    resolve: (alertId: string) => Action
    readOnly?: boolean
}) {
    if (alerts.length === 0) return null
    return (
        <section aria-label='Emergency alerts' className='space-y-3'>
            <AlarmSound ringing={alerts.some(a => a.status === 'active')} />
            {alerts.map(a => (
                <div key={a.id} className='rounded-2xl border-2 border-red-500 bg-red-50 p-4 shadow-lg'>
                    <div className='flex items-start gap-3'>
                        <Siren className={`h-8 w-8 shrink-0 text-red-600 ${a.status === 'active' ? 'animate-pulse' : ''}`} aria-hidden />
                        <div className='min-w-0 flex-1'>
                            <p className='text-xs font-bold tracking-wider text-red-600 uppercase'>{a.status === 'active' ? 'Emergency: nobody responding yet' : 'Emergency: being handled'}</p>
                            <p className='text-xl font-extrabold text-red-900'>{a.house}</p>
                            <p className='text-sm text-red-800'>{a.address}</p>
                            <p className='mt-1 text-sm text-red-800'>{a.callerName || 'Resident'} · raised at {formatTime(a.createdAt)}</p>
                            <p className='text-xs text-red-700'>
                                {a.locationSource === 'gps' ? `Phone GPS${a.accuracyMeters ? ` (±${a.accuracyMeters} m)` : ''}` : a.locationSource === 'estate' ? 'No GPS: map shows the estate' : 'No GPS: map searches the address'}
                            </p>
                        </div>
                    </div>
                    <div className='mt-3 grid grid-cols-2 gap-2'>
                        <a href={a.mapLink} target='_blank' rel='noreferrer' className='btn-danger py-3'><MapPin className='h-4 w-4' aria-hidden /> Map</a>
                        <a href={`tel:${a.callerPhone}`} className='btn-secondary py-3'><Phone className='h-4 w-4' aria-hidden /> {formatNigerianPhone(a.callerPhone)}</a>
                    </div>
                    {!readOnly && (
                        <div className='mt-3 space-y-2'>
                            {a.status === 'active' && (
                                <ActionForm action={acknowledge(a.id)}>
                                    <SubmitButton className='w-full py-3'>I&apos;m responding</SubmitButton>
                                </ActionForm>
                            )}
                            <details className='rounded-xl bg-white p-3 ring-1 ring-red-200'>
                                <summary className='cursor-pointer text-sm font-semibold text-slate-700'>Close this alert</summary>
                                <ActionForm action={resolve(a.id)} className='mt-2 space-y-2'>
                                    <input name='note' required minLength={3} placeholder='What happened? e.g. Intruder chased off, police called' aria-label='What happened' className='w-full' />
                                    <label className='flex items-center gap-2 text-sm'><input type='checkbox' name='falseAlarm' className='h-4 w-4' /> It was a false alarm</label>
                                    <SubmitButton variant='secondary' className='w-full'>Close alert</SubmitButton>
                                </ActionForm>
                            </details>
                        </div>
                    )}
                </div>
            ))}
        </section>
    )
}
