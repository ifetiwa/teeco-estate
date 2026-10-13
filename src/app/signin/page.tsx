import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { ActionForm, Field, SubmitButton } from '@/components/ActionForm'
import { Logo } from '@/components/Logo'
import { PhoneInput } from '@/components/PhoneInput'
import { getCurrentUser } from '@/lib/auth/current'

import { requestCodeAction } from './actions'

export const metadata: Metadata = { title: 'Sign in' }

export default async function SignInPage ({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
    const { next } = await searchParams
    if (await getCurrentUser()) redirect(next || '/app')
    return (
        <main className='mx-auto max-w-sm px-4 py-10'>
            <Logo />
            <h1 className='mt-8 text-2xl font-semibold'>Sign in</h1>
            <p className='mt-1 text-slate-600'>We will text a 6-digit code to your phone.</p>
            <ActionForm action={requestCodeAction} className='mt-6 flex flex-col gap-4' resetOnSuccess={false}>
                <input type='hidden' name='next' value={next ?? ''} />
                <Field label='Phone number' name='phone'>
                    <PhoneInput name='phone' autoFocus />
                </Field>
                <SubmitButton>Send code</SubmitButton>
            </ActionForm>
        </main>
    )
}
