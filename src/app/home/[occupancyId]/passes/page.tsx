import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ActionForm, Field, SubmitButton } from '@/components/ActionForm'
import { AppHeader } from '@/components/AppHeader'
import { PhoneInput } from '@/components/PhoneInput'
import { actorFromUser } from '@/lib/access'
import { requireUser } from '@/lib/auth/current'
import { NotFoundError } from '@/lib/errors'
import { formatDateTime, toLagosInputValue } from '@/lib/format'
import { getMyHome } from '@/lib/residents'
import { listUnitPasses, passState, visitStatusLabel } from '@/lib/visitors'

import { cancelPassAction, createPassAction } from '../actions'

export const metadata: Metadata = { title: 'Visitor passes' }

const STATE_LABEL: Record<string, string> = { active: 'Active', not_yet_valid: 'Upcoming', expired: 'Expired', used: 'Used', cancelled: 'Cancelled' }

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
                <div>
                    <Link href={`/home/${occupancyId}`} className='text-sm text-brand-700 underline'>← {home.unit.label}, {home.zone.name}</Link>
                    <h1 className='mt-2 text-xl font-semibold'>Visitor passes</h1>
                </div>

                <section className='card'>
                    <h2 className='font-semibold'>New pass</h2>
                    <ActionForm action={createPassAction.bind(null, occupancyId)} className='mt-3 grid gap-3 sm:grid-cols-2' resetOnSuccess={false}>
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
                        <div className='self-end'><SubmitButton className='w-full'>Create pass</SubmitButton></div>
                    </ActionForm>
                    <p className='mt-2 text-xs text-slate-500'>Times are Nigerian time (WAT).</p>
                </section>

                <section className='card'>
                    <h2 className='font-semibold'>Your passes</h2>
                    {passes.length === 0 && <p className='mt-2 text-sm text-slate-600'>No passes yet.</p>}
                    <ul className='mt-2 divide-y divide-slate-100'>
                        {passes.map(p => {
                            const state = passState(p, now)
                            return (
                                <li key={p.id} className='flex flex-wrap items-center justify-between gap-2 py-3'>
                                    <Link href={`/home/${occupancyId}/passes/${p.id}`} className='min-w-0'>
                                        <p className='font-medium'>{p.visitorName} <span className={`ml-1 text-xs ${state === 'active' ? 'text-brand-700' : 'text-slate-500'}`}>{STATE_LABEL[state]}</span></p>
                                        <p className='text-sm text-slate-600'><span className='font-mono'>{p.code}</span> · {formatDateTime(p.validFrom)} to {formatDateTime(p.validUntil)}</p>
                                    </Link>
                                    {(state === 'active' || state === 'not_yet_valid') && (
                                        <ActionForm action={cancelPassAction.bind(null, occupancyId, p.id)} confirm={`Cancel the pass for ${p.visitorName}?`}>
                                            <button className='text-sm text-red-700 underline'>Cancel</button>
                                        </ActionForm>
                                    )}
                                </li>
                            )
                        })}
                    </ul>
                </section>

                <section className='card'>
                    <h2 className='font-semibold'>Recent visitors</h2>
                    {visits.length === 0 && <p className='mt-2 text-sm text-slate-600'>No visitors yet.</p>}
                    <ul className='mt-2 space-y-1 text-sm'>
                        {visits.map(v => (
                            <li key={v.id}>
                                <span className='font-medium'>{v.visitorName}</span> · {visitStatusLabel(v.status)}
                                {v.checkedInAt ? ` · in ${formatDateTime(v.checkedInAt)}` : ''}{v.checkedOutAt ? ` · out ${formatDateTime(v.checkedOutAt)}` : ''}
                            </li>
                        ))}
                    </ul>
                </section>
            </main>
        </>
    )
}
