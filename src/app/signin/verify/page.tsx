import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { ActionForm, Field, SubmitButton } from '@/components/ActionForm'
import { Logo } from '@/components/Logo'
import { formatNigerianPhone, normalizeNigerianPhone } from '@/lib/phone'

import { resendCodeAction, verifyCodeAction } from '../actions'

export const metadata: Metadata = { title: 'Enter code' }

export default async function VerifyPage ({ searchParams }: { searchParams: Promise<{ phone?: string, next?: string }> }) {
    const { phone: rawPhone, next } = await searchParams
    const phone = rawPhone ? normalizeNigerianPhone(rawPhone) : null
    if (!phone) redirect('/signin')
    return (
        <main className='mx-auto max-w-sm px-4 py-10'>
            <Logo />
            <h1 className='mt-8 text-2xl font-semibold'>Enter your code</h1>
            <p className='mt-1 text-slate-600'>Sent by SMS to {formatNigerianPhone(phone)}.</p>
            <ActionForm action={verifyCodeAction} className='mt-6 flex flex-col gap-4' resetOnSuccess={false}>
                <input type='hidden' name='phone' value={phone} />
                <input type='hidden' name='next' value={next ?? ''} />
                <Field label='6-digit code' name='code'>
                    <input id='code' name='code' inputMode='numeric' autoComplete='one-time-code' pattern='\d{6}' maxLength={6} required autoFocus className='text-center text-2xl tracking-[0.5em]' />
                </Field>
                <SubmitButton>Sign in</SubmitButton>
            </ActionForm>
            <ActionForm action={resendCodeAction} className='mt-4'>
                <input type='hidden' name='phone' value={phone} />
                <button type='submit' className='text-sm text-brand-700 underline'>Send a new code</button>
            </ActionForm>
            <Link href='/signin' className='mt-2 block text-sm text-slate-600 underline'>Use a different number</Link>
        </main>
    )
}
