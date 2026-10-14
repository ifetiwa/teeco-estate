'use server'

import { revalidatePath } from 'next/cache'

import { actorFromUser } from '@/lib/access'
import { requireUser } from '@/lib/auth/current'
import { markAllNotificationsRead } from '@/lib/notifications'

export async function markNotificationsReadAction (): Promise<void> {
    const user = await requireUser()
    await markAllNotificationsRead(actorFromUser(user))
    revalidatePath('/app')
}
