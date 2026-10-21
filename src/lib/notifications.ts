import { and, desc, eq, isNull, sql } from 'drizzle-orm'

import { type Queryable, afterCommit, withDbContext } from '@/db'
import { notifications, occupancies } from '@/db/schema'
import { type Actor } from '@/lib/access'
import { sendPush } from '@/lib/push'
import { getSmsProvider } from '@/lib/sms'

export interface NotificationInput {
    estateId: string
    type: string
    title: string
    body: string
    link?: string
}

export type NewNotification = typeof notifications.$inferInsert

/**
 * Saves in-app notifications and, once the transaction commits, pushes each one to the recipient's phones.
 * Every notification in the app goes through here.
 */
export async function insertNotifications (tx: Queryable, rows: NewNotification[]): Promise<void> {
    if (rows.length === 0) return
    await tx.insert(notifications).values(rows)
    afterCommit(tx, () => sendPush(rows.map(r => ({
        userId: r.userId, title: r.title, body: r.body, link: r.link, urgent: r.type === 'emergency.raised',
    }))))
}

export interface PendingSms {
    to: string
    body: string
}

/**
 * Notifies the current residents of a unit in-app. When `sms` is true, SMS messages are returned for the caller
 * to send after the transaction commits (so a rolled-back change never texts anyone).
 * Build 8 adds push, per-user preferences and quiet hours on top of this.
 */
export async function notifyUnitResidents (tx: Queryable, unitId: string, n: NotificationInput, opts: { sms?: boolean } = {}): Promise<PendingSms[]> {
    const residents = await tx.select({ userId: occupancies.userId, phone: occupancies.phone }).from(occupancies)
        .where(and(eq(occupancies.unitId, unitId), eq(occupancies.status, 'active')))
    const withAccounts = residents.filter((r): r is { userId: string, phone: string } => r.userId !== null)
    if (withAccounts.length) {
        await insertNotifications(tx, withAccounts.map(r => ({
            estateId: n.estateId, userId: r.userId, type: n.type, title: n.title, body: n.body, link: n.link,
        })))
    }
    return opts.sms ? residents.map(r => ({ to: r.phone, body: `${n.title}. ${n.body}` })) : []
}

export async function sendPendingSms (messages: PendingSms[]): Promise<void> {
    const sms = getSmsProvider()
    await Promise.all(messages.map(m => sms.send(m).catch((e) => console.error('[sms] send failed', e))))
}

export async function listMyNotifications (actor: Actor, limit = 30) {
    return withDbContext({ userId: actor.userId }, tx =>
        tx.select().from(notifications).where(eq(notifications.userId, actor.userId)).orderBy(desc(notifications.createdAt)).limit(limit))
}

export async function countUnreadNotifications (actor: Actor): Promise<number> {
    const [row] = await withDbContext({ userId: actor.userId }, tx =>
        tx.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, actor.userId), isNull(notifications.readAt))))
    return row.n
}

export async function markAllNotificationsRead (actor: Actor): Promise<void> {
    await withDbContext({ userId: actor.userId }, tx =>
        tx.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, actor.userId), isNull(notifications.readAt))))
}

export async function markNotificationRead (actor: Actor, notificationId: string): Promise<void> {
    await withDbContext({ userId: actor.userId }, tx =>
        tx.update(notifications).set({ readAt: new Date() })
            .where(and(eq(notifications.id, notificationId), eq(notifications.userId, actor.userId), isNull(notifications.readAt))))
}
