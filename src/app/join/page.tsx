import { KeyRound } from 'lucide-react'
import type { Metadata } from 'next'

import { ActionForm, Field, SubmitButton } from '@/components/ActionForm'
import { AppHeader } from '@/components/AppHeader'
import { PageHeader, SectionCard } from '@/components/ui'
import { requireUser } from '@/lib/auth/current'
import { findEstateByJoinCode } from '@/lib/estates'
import { AppError } from '@/lib/errors'

import { lookupJoinCodeAction, registerAction } from './actions'

export const metadata: Metadata = { title: 'Join an estate' }

export default async function JoinPage ({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
    const user = await requireUser()
    const { code } = await searchParams

    let found: Awaited<ReturnType<typeof findEstateByJoinCode>> | null = null
    let lookupError: string | null = null
    if (code) {
        try {
            found = await findEstateByJoinCode(code)
        } catch (e) {
            if (!(e instanceof AppError)) throw e
            lookupError = e.message
        }
    }

    const zones = found ? [...new Map(found.units.map(u => [u.zoneId, u.zoneName])).entries()] : []

    return (
        <>
            <AppHeader user={user} />
            <main className='mx-auto max-w-lg px-4 py-8'>
                <PageHeader title='Join an estate' back={{ href: '/app', label: 'Home' }} description={found ? undefined : 'Enter the code from your estate office.'} />
                {!found && (
                    <SectionCard icon={KeyRound} title='Estate join code'>
                        <ActionForm action={lookupJoinCodeAction} className='flex flex-col gap-4' resetOnSuccess={false}>
                            <Field label='Estate join code' name='joinCode' hint='6 letters and numbers, from your estate office'>
                                <input id='joinCode' name='joinCode' defaultValue={code} required maxLength={8} autoCapitalize='characters' className='text-center font-mono text-2xl uppercase tracking-[0.3em]' />
                            </Field>
                            {lookupError && <p className='rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200'>{lookupError}</p>}
                            <SubmitButton className='w-full py-3'>Continue</SubmitButton>
                        </ActionForm>
                    </SectionCard>
                )}
                {found && (
                    <SectionCard>
                        <p className='rounded-lg bg-brand-50 px-3 py-2 text-brand-800'>
                            Joining <strong>{found.estate.name}</strong>{found.estate.district ? `, ${found.estate.district}` : ''}.
                            The estate admin will approve your request.
                        </p>
                        <ActionForm action={registerAction} className='mt-5 flex flex-col gap-4' resetOnSuccess={false}>
                            <input type='hidden' name='joinCode' value={code} />
                            <Field label='Your full name' name='name'>
                                <input id='name' name='name' defaultValue={user.name} required autoComplete='name' />
                            </Field>
                            <Field label='House or flat' name='unitId'>
                                <select id='unitId' name='unitId' required defaultValue=''>
                                    <option value='' disabled>Choose…</option>
                                    {zones.map(([zoneId, zoneName]) => (
                                        <optgroup key={zoneId} label={zoneName}>
                                            {found.units.filter(u => u.zoneId === zoneId).map(u => (
                                                <option key={u.unitId} value={u.unitId}>{u.unitLabel}, {zoneName}</option>
                                            ))}
                                        </optgroup>
                                    ))}
                                </select>
                            </Field>
                            <Field label='You are the' name='relation'>
                                <select id='relation' name='relation' required defaultValue='owner'>
                                    <option value='owner'>Owner</option>
                                    <option value='tenant'>Tenant</option>
                                    <option value='household'>Household member</option>
                                </select>
                            </Field>
                            <Field label='Email (optional)' name='email'>
                                <input id='email' name='email' type='email' autoComplete='email' defaultValue={user.email ?? ''} />
                            </Field>
                            <Field label='Move-in date (optional)' name='moveInDate'>
                                <input id='moveInDate' name='moveInDate' type='date' />
                            </Field>
                            <SubmitButton className='w-full py-3'>Send request</SubmitButton>
                        </ActionForm>
                    </SectionCard>
                )}
            </main>
        </>
    )
}
