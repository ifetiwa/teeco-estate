import 'server-only'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'

import { SESSION_COOKIE, type SessionUser, createSession, destroySession, getUserBySessionToken } from './session'

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
    const store = await cookies()
    return getUserBySessionToken(store.get(SESSION_COOKIE)?.value)
})

/** For pages and actions that need a signed-in user; redirects to sign-in otherwise. */
export async function requireUser (): Promise<SessionUser> {
    const user = await getCurrentUser()
    if (!user) redirect('/signin')
    return user
}

export async function signIn (userId: string): Promise<void> {
    const { token, expiresAt } = await createSession(userId)
    const store = await cookies()
    store.set(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        expires: expiresAt,
    })
}

export async function signOut (): Promise<void> {
    const store = await cookies()
    await destroySession(store.get(SESSION_COOKIE)?.value)
    store.delete(SESSION_COOKIE)
}
