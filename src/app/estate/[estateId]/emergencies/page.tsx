import { MapPin, Siren } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { EmergencyPanel, toPanelAlert } from '@/components/EmergencyPanel'
import { Badge, type BadgeTone, EmptyState, PageHeader } from '@/components/ui'
import { DISTRESS_STATUS_LABEL, listAlerts } from '@/lib/emergency'
import { formatDateTime } from '@/lib/format'
import { formatNigerianPhone } from '@/lib/phone'

import { acknowledgeAlertStaffAction, resolveAlertStaffAction } from '../actions'
import { loadStaffEstate } from '../context'

export const metadata: Metadata = { title: 'Emergencies' }
export const dynamic = 'force-dynamic'

const TONE: Record<string, BadgeTone> = { active: 'red', acknowledged: 'amber', resolved: 'green', false_alarm: 'slate' }

export default async function EmergenciesPage ({ params }: { params: Promise<{ estateId: string }> }) {
    const { estateId } = await params
    const { actor, estate, can } = await loadStaffEstate(estateId)
    if (!can('emergency.read')) notFound()
    const alerts = await listAlerts(actor, estate.id)
    const open = alerts.filter(a => a.alert.status === 'active' || a.alert.status === 'acknowledged')

    return (
        <div className='space-y-6'>
            <PageHeader title='Emergencies' description='Alerts raised with the emergency button by residents.' />
            <EmergencyPanel
                alerts={open.map(toPanelAlert)}
                acknowledge={id => acknowledgeAlertStaffAction.bind(null, estate.id, id)}
                resolve={id => resolveAlertStaffAction.bind(null, estate.id, id)}
                readOnly={!can('emergency.respond')}
            />
            {alerts.length === 0
                ? <EmptyState icon={Siren} title='No alerts yet'>When a resident holds the emergency button, every guard and resident is alerted and it is logged here.</EmptyState>
                : (
                    <div className='table-wrap'>
                        <table className='data-table'>
                            <thead><tr><th>Raised</th><th>House</th><th>Resident</th><th>Status</th><th>Outcome</th><th>Location</th></tr></thead>
                            <tbody>
                                {alerts.map(a => (
                                    <tr key={a.alert.id}>
                                        <td className='whitespace-nowrap'>{formatDateTime(a.alert.createdAt)}</td>
                                        <td className='font-medium'>{a.unitLabel}, {a.zoneName}</td>
                                        <td>{a.raisedByName}<span className='block text-xs text-slate-500'>{formatNigerianPhone(a.raisedByPhone)}</span></td>
                                        <td><Badge tone={TONE[a.alert.status]}>{DISTRESS_STATUS_LABEL[a.alert.status]}</Badge></td>
                                        <td className='text-sm'>
                                            {a.alert.closingNote}
                                            {a.alert.acknowledgedAt && <span className='block text-xs text-slate-500'>Responded {formatDateTime(a.alert.acknowledgedAt)}</span>}
                                        </td>
                                        <td><a href={a.mapLink} target='_blank' rel='noreferrer' className='inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline'><MapPin className='h-4 w-4' aria-hidden />Map</a></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
        </div>
    )
}
