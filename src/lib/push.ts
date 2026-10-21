import { createSign } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { getDb } from '@/db'
import { pushDevices } from '@/db/schema'
import type { Actor } from '@/lib/access'

// Push notifications through Firebase Cloud Messaging (FCM HTTP v1). Phones register a token from the Android app;
// every in-app notification is also pushed to the recipient's phones. Without FIREBASE_SERVICE_ACCOUNT set, nothing
// is sent (development, tests, or before Firebase is set up).

export interface PushMessage {
    userId: string
    title: string
    body: string
    link?: string | null
    /** Emergency alerts: loud, high-priority channel that sounds even when the phone is on silent-ish modes */
    urgent?: boolean
}

export interface PushSender {
    send (token: string, m: PushMessage): Promise<'sent' | 'invalid-token'>
}

const tokenSchema = z.string().trim().min(20).max(4096)

/** Saves (or moves to this user) the phone's FCM registration token. */
export async function registerPushDevice (actor: Actor, rawToken: string, platform = 'android'): Promise<void> {
    const token = tokenSchema.parse(rawToken)
    await getDb().insert(pushDevices).values({ userId: actor.userId, token, platform })
        .onConflictDoUpdate({ target: pushDevices.token, set: { userId: actor.userId, platform, lastSeenAt: new Date() } })
}

/** Forgets the phone (e.g. on sign-out), so the next person to use it doesn't get this user's alerts. */
export async function unregisterPushDevice (rawToken: string): Promise<void> {
    await getDb().delete(pushDevices).where(eq(pushDevices.token, tokenSchema.parse(rawToken)))
}

// ---------- Firebase Cloud Messaging ----------

interface ServiceAccount { project_id: string, client_email: string, private_key: string }

const base64url = (s: string | Buffer) => Buffer.from(s).toString('base64url')

/** Sends through FCM HTTP v1, using an OAuth token made from the service account (cached for its hour of validity). */
export class FcmSender implements PushSender {
    private accessToken: { value: string, expiresAt: number } | null = null

    constructor (private readonly account: ServiceAccount, private readonly fetchFn: typeof fetch = fetch) {}

    private async token (): Promise<string> {
        if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) return this.accessToken.value
        const now = Math.floor(Date.now() / 1000)
        const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
        const claims = base64url(JSON.stringify({
            iss: this.account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
            aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
        }))
        const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(this.account.private_key).toString('base64url')
        const res = await this.fetchFn('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${signature}` }),
            signal: AbortSignal.timeout(10_000),
        })
        const data = await res.json() as { access_token?: string, expires_in?: number, error?: string }
        if (!res.ok || !data.access_token) throw new Error(`FCM auth failed: ${data.error ?? res.status}`)
        this.accessToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 }
        return data.access_token
    }

    async send (token: string, m: PushMessage): Promise<'sent' | 'invalid-token'> {
        const res = await this.fetchFn(`https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await this.token()}` },
            body: JSON.stringify({
                message: {
                    token,
                    notification: { title: m.title, body: m.body },
                    data: { link: m.link ?? '/notifications' },
                    android: {
                        priority: 'high',
                        notification: { channel_id: m.urgent ? 'emergency' : 'general', sound: 'default', ...(m.urgent ? { notification_priority: 'PRIORITY_MAX' } : {}) },
                    },
                },
            }),
            signal: AbortSignal.timeout(10_000),
        })
        if (res.ok) return 'sent'
        const err = await res.json().catch(() => ({})) as { error?: { status?: string, details?: Array<{ errorCode?: string }> } }
        // The app was uninstalled or the token rotated: drop it
        if (res.status === 404 || err.error?.details?.some(d => d.errorCode === 'UNREGISTERED')) return 'invalid-token'
        throw new Error(`FCM send failed: ${err.error?.status ?? res.status}`)
    }
}

const globalForPush = globalThis as unknown as { teecoPush?: PushSender | null }

export function getPushSender (): PushSender | null {
    if (globalForPush.teecoPush === undefined) {
        const raw = process.env.FIREBASE_SERVICE_ACCOUNT
        globalForPush.teecoPush = raw ? new FcmSender(JSON.parse(raw) as ServiceAccount) : null
    }
    return globalForPush.teecoPush
}

export function setPushSender (s: PushSender | null): void {
    globalForPush.teecoPush = s
}

/** Sends each message to every phone its user has registered. Never throws: push is best-effort on top of in-app and SMS. */
export async function sendPush (messages: PushMessage[]): Promise<void> {
    const sender = getPushSender()
    if (!sender || messages.length === 0) return
    const userIds = [...new Set(messages.map(m => m.userId))]
    const devices = await getDb().select({ userId: pushDevices.userId, token: pushDevices.token }).from(pushDevices).where(inArray(pushDevices.userId, userIds))
    const invalid: string[] = []
    await Promise.all(messages.flatMap(m => devices.filter(d => d.userId === m.userId).map(async (d) => {
        try {
            if (await sender.send(d.token, m) === 'invalid-token') invalid.push(d.token)
        } catch (e) {
            console.error('[push] send failed', e)
        }
    })))
    if (invalid.length) await getDb().delete(pushDevices).where(inArray(pushDevices.token, invalid))
}
