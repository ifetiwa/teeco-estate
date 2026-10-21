'use server'

import { revalidatePath } from 'next/cache'

import { actorFromUser } from '@/lib/access'
import { requireUser } from '@/lib/auth/current'
import { countUnreadNotifications, listMyNotifications, markAllNotificationsRead, markNotificationRead } from '@/lib/notifications'

export interface NotificationItem {
    id: string
    type: string
    title: string
    body: string
    link: string | null
    read: boolean
    createdAt: string
}

/** The latest notifications for the bell's drop-down. */
export async function latestNotificationsAction (): Promise<{ items: NotificationItem[], unread: number }> {
    const user = await requireUser()
    const actor = actorFromUser(user)
    const [rows, unread] = await Promise.all([listMyNotifications(actor, 8), countUnreadNotifications(actor)])
    return {
        unread,
        items: rows.map(n => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, read: n.readAt !== null, createdAt: n.createdAt.toISOString() })),
    }
}

export async function markNotificationReadAction (id: string): Promise<void> {
    const user = await requireUser()
    await markNotificationRead(actorFromUser(user), id)
}

export async function markAllReadAction (): Promise<void> {
    const user = await requireUser()
    await markAllNotificationsRead(actorFromUser(user))
    revalidatePath('/', 'layout')
}
