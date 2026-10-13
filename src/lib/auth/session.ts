import { and, eq, gt } from 'drizzle-orm'

import { getDb } from '@/db'
import { sessions, users } from '@/db/schema'
import { randomToken, sha256 } from '@/lib/crypto'

export const SESSION_COOKIE = 'teeco_session'
export const SESSION_TTL_DAYS = 30
const TOUCH_INTERVAL_MS = 60 * 60_000

export type SessionUser = typeof users.$inferSelect

export async function createSession (userId: string): Promise<{ token: string, expiresAt: Date }> {
    const token = randomToken()
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000)
    await getDb().insert(sessions).values({ tokenHash: sha256(token), userId, expiresAt })
    return { token, expiresAt }
}

/** Resolves a session token to its user, extending the session while it is in use. */
export async function getUserBySessionToken (token: string | undefined): Promise<SessionUser | null> {
    if (!token) return null
    const db = getDb()
    const [row] = await db.select({ session: sessions, user: users }).from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    if (!row) return null
    if (Date.now() - row.session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
        await db.update(sessions)
            .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000) })
            .where(eq(sessions.id, row.session.id))
    }
    return row.user
}

export async function destroySession (token: string | undefined): Promise<void> {
    if (!token) return
    await getDb().delete(sessions).where(eq(sessions.tokenHash, sha256(token)))
}
