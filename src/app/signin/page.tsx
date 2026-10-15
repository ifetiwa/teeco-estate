import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { ActionForm, Field, SubmitButton } from '@/components/ActionForm'
import { AuthShell } from '@/components/AuthShell'
import { PhoneInput } from '@/components/PhoneInput'
import { getCurrentUser } from '@/lib/auth/current'

import { requestCodeAction } from './actions'

export const metadata: Metadata = { title: 'Sign in' }

export default async function SignInPage ({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
    const { next } = await searchParams
    if (await getCurrentUser()) redirect(next || '/app')
    return (
        <AuthShell>
            <h1 className='text-3xl font-bold'>Sign in</h1>
            <p className='mt-2 text-slate-600'>We will text a 6-digit code to your phone.</p>
            <ActionForm action={requestCodeAction} className='mt-8 flex flex-col gap-5' resetOnSuccess={false}>
                <input type='hidden' name='next' value={next ?? ''} />
                <Field label='Phone number' name='phone'>
                    <PhoneInput name='phone' autoFocus />
                </Field>
                <SubmitButton className='w-full py-3 text-base'>Send code</SubmitButton>
            </ActionForm>
            <p className='mt-6 text-xs text-slate-500'>New here? Sign in with your phone, then use the join code from your estate office.</p>
        </AuthShell>
    )
}
