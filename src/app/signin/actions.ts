'use server'

import { redirect } from 'next/navigation'

import { type ActionState, toActionError } from '@/lib/actions'
import { signIn, signOut } from '@/lib/auth/current'
import { requestOtp, verifyOtp } from '@/lib/auth/otp'

function safeNext (next: unknown): string {
    return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/app'
}

export async function requestCodeAction (_: ActionState, formData: FormData): Promise<ActionState> {
    let phone: string
    try {
        ({ phone } = await requestOtp(String(formData.get('phone') ?? '')))
    } catch (e) {
        return toActionError(e)
    }
    const next = safeNext(formData.get('next'))
    redirect(`/signin/verify?phone=${encodeURIComponent(phone)}&next=${encodeURIComponent(next)}`)
}

export async function verifyCodeAction (_: ActionState, formData: FormData): Promise<ActionState> {
    try {
        const { userId } = await verifyOtp(String(formData.get('phone') ?? ''), String(formData.get('code') ?? ''))
        await signIn(userId)
    } catch (e) {
        return toActionError(e)
    }
    redirect(safeNext(formData.get('next')))
}

export async function resendCodeAction (_: ActionState, formData: FormData): Promise<ActionState> {
    try {
        await requestOtp(String(formData.get('phone') ?? ''))
        return { ok: true, message: 'A new code has been sent.', nonce: Date.now() }
    } catch (e) {
        return toActionError(e)
    }
}

export async function signOutAction (): Promise<void> {
    await signOut()
    redirect('/signin')
}
