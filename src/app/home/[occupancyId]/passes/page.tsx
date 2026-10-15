import { ChevronRight, Clock, QrCode, Ticket } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ActionForm, Field, SubmitButton } from '@/components/ActionForm'
import { AppHeader } from '@/components/AppHeader'
import { PhoneInput } from '@/components/PhoneInput'
import { Badge, type BadgeTone, EmptyState, PageHeader, SectionCard, VISIT_STATUS_TONE } from '@/components/ui'
import { actorFromUser } from '@/lib/access'
import { requireUser } from '@/lib/auth/current'
import { NotFoundError } from '@/lib/errors'
import { formatDateTime, toLagosInputValue } from '@/lib/format'
import { getMyHome } from '@/lib/residents'
import { listUnitPasses, passState, visitStatusLabel } from '@/lib/visitors'

import { cancelPassAction, createPassAction } from '../actions'

export const metadata: Metadata = { title: 'Visitor passes' }

const STATE: Record<string, { label: string, tone: BadgeTone }> = {
    active: { label: 'Active', tone: 'green' },
    not_yet_valid: { label: 'Upcoming', tone: 'blue' },
    expired: { label: 'Expired', tone: 'slate' },
    used: { label: 'Used', tone: 'slate' },
    cancelled: { label: 'Cancelled', tone: 'red' },
}

export default async function PassesPage ({ params }: { params: Promise<{ occupancyId: string }> }) {
    const { occupancyId } = await params
    const user = await requireUser()
    const actor = actorFromUser(user)
    let home
    try {
        home = await getMyHome(actor, occupancyId)
    } catch (e) {
        if (e instanceof NotFoundError || (e as { code?: string }).code === '22P02') notFound()
        throw e
    }
    const { passes, visits } = await listUnitPasses(actor, home.occupancy.estateId, home.unit.id)
    const now = new Date()
    const from = toLagosInputValue(now)
    const until = toLagosInputValue(new Date(now.getTime() + 12 * 3_600_000))

    return (
        <>
            <AppHeader user={user} />
            <main className='mx-auto max-w-3xl space-y-6 px-4 py-6'>
                <PageHeader back={{ href: `/home/${occupancyId}`, label: `${home.unit.label}, ${home.zone.name}` }} title='Visitor passes' description='Create a code, share it, and the gate will let your visitor in.' />

                <SectionCard title='New pass' icon={QrCode}>
                    <ActionForm action={createPassAction.bind(null, occupancyId)} className='grid gap-4 sm:grid-cols-2' resetOnSuccess={false}>
                        <Field label='Visitor name' name='visitorName'><input id='visitorName' name='visitorName' required autoComplete='off' /></Field>
                        <Field label='Visitor phone (optional)' name='visitorPhone'><PhoneInput name='visitorPhone' required={false} /></Field>
                        <Field label='Valid from' name='validFrom'><input id='validFrom' name='validFrom' type='datetime-local' defaultValue={from} required /></Field>
                        <Field label='Valid until' name='validUntil'><input id='validUntil' name='validUntil' type='datetime-local' defaultValue={until} required /></Field>
                        <Field label='Purpose (optional)' name='purpose'><input id='purpose' name='purpose' placeholder='e.g. Family visit' /></Field>
                        <Field label='Vehicle plate (optional)' name='vehiclePlate'><input id='vehiclePlate' name='vehiclePlate' placeholder='ABC-123DE' className='uppercase' /></Field>
                        <Field label='Can be used' name='usage'>
                            <select id='usage' name='usage' defaultValue='single'>
                                <option value='single'>Once</option>
                                <option value='multi'>Many times until it ends</option>
                            </select>
                        </Field>
                        <div className='flex items-end'><SubmitButton className='w-full py-3'>Create pass</SubmitButton></div>
                    </ActionForm>
                    <p className='mt-3 text-xs text-slate-500'>Times are Nigerian time (WAT).</p>
                </SectionCard>

                <SectionCard title='Your passes' icon={Ticket}>
                    {passes.length === 0
                        ? <EmptyState icon={Ticket} title='No passes yet'>Create one above for your next visitor.</EmptyState>
                        : (
                            <ul className='-mx-2 divide-y divide-slate-100'>
                                {passes.map(p => {
                                    const state = passState(p, now)
                                    return (
                                        <li key={p.id} className='flex flex-wrap items-center justify-between gap-2 px-2 py-3'>
                                            <Link href={`/home/${occupancyId}/passes/${p.id}`} className='flex min-w-0 flex-1 items-center gap-3 rounded-lg'>
                                                <span className='rounded-lg bg-brand-50 px-2.5 py-1.5 font-mono font-bold tracking-wider text-brand-800'>{p.code}</span>
                                                <span className='min-w-0'>
                                                    <span className='flex flex-wrap items-center gap-2 font-semibold'>{p.visitorName} <Badge tone={STATE[state].tone}>{STATE[state].label}</Badge></span>
                                                    <span className='block text-sm text-slate-500'>{formatDateTime(p.validFrom)} to {formatDateTime(p.validUntil)}</span>
                                                </span>
                                                <ChevronRight className='ml-auto h-5 w-5 shrink-0 text-slate-400' aria-hidden />
                                            </Link>
                                            {(state === 'active' || state === 'not_yet_valid') && (
                                                <ActionForm action={cancelPassAction.bind(null, occupancyId, p.id)} confirm={`Cancel the pass for ${p.visitorName}?`}>
                                                    <button className='text-sm font-medium text-red-600 hover:underline'>Cancel</button>
                                                </ActionForm>
                                            )}
                                        </li>
                                    )
                                })}
                            </ul>
                        )}
                </SectionCard>

                <SectionCard title='Recent visitors' icon={Clock}>
                    {visits.length === 0 && <p className='text-sm text-slate-500'>No visitors yet.</p>}
                    <ul className='space-y-2 text-sm'>
                        {visits.map(v => (
                            <li key={v.id} className='flex flex-wrap items-center gap-2'>
                                <span className='font-semibold'>{v.visitorName}</span>
                                <Badge tone={VISIT_STATUS_TONE[v.status]}>{visitStatusLabel(v.status)}</Badge>
                                <span className='text-slate-500'>
                                    {v.checkedInAt ? `in ${formatDateTime(v.checkedInAt)}` : formatDateTime(v.createdAt)}{v.checkedOutAt ? ` · out ${formatDateTime(v.checkedOutAt)}` : ''}
                                </span>
                            </li>
                        ))}
                    </ul>
                </SectionCard>
            </main>
        </>
    )
}
