import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { ActionForm, Field, SubmitButton } from '@/components/ActionForm'
import { AuthShell } from '@/components/AuthShell'
import { formatNigerianPhone, normalizeNigerianPhone } from '@/lib/phone'

import { resendCodeAction, verifyCodeAction } from '../actions'

export const metadata: Metadata = { title: 'Enter code' }

export default async function VerifyPage ({ searchParams }: { searchParams: Promise<{ phone?: string, next?: string }> }) {
    const { phone: rawPhone, next } = await searchParams
    const phone = rawPhone ? normalizeNigerianPhone(rawPhone) : null
    if (!phone) redirect('/signin')
    return (
        <AuthShell>
            <h1 className='text-3xl font-bold'>Enter your code</h1>
            <p className='mt-2 text-slate-600'>Sent by SMS to <span className='font-semibold text-slate-800'>{formatNigerianPhone(phone)}</span>.</p>
            <ActionForm action={verifyCodeAction} className='mt-8 flex flex-col gap-5' resetOnSuccess={false}>
                <input type='hidden' name='phone' value={phone} />
                <input type='hidden' name='next' value={next ?? ''} />
                <Field label='6-digit code' name='code'>
                    <input id='code' name='code' inputMode='numeric' autoComplete='one-time-code' pattern='\d{6}' maxLength={6} required autoFocus
                        className='py-4 text-center font-mono text-3xl tracking-[0.5em]' />
                </Field>
                <SubmitButton className='w-full py-3 text-base'>Sign in</SubmitButton>
            </ActionForm>
            <div className='mt-6 flex items-center justify-between text-sm'>
                <ActionForm action={resendCodeAction}>
                    <input type='hidden' name='phone' value={phone} />
                    <button type='submit' className='font-medium text-brand-700 hover:underline'>Send a new code</button>
                </ActionForm>
                <Link href='/signin' className='text-slate-600 hover:underline'>Use a different number</Link>
            </div>
        </AuthShell>
    )
}
