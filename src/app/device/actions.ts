'use server'

import { actorFromUser } from '@/lib/access'
import { requireUser } from '@/lib/auth/current'
import { registerPushDevice, unregisterPushDevice } from '@/lib/push'

/** Called by the Android app after Firebase gives it a push token. */
export async function registerPushDeviceAction (token: string): Promise<void> {
    const user = await requireUser()
    await registerPushDevice(actorFromUser(user), token)
}

/** Called before signing out, so this phone stops receiving the user's alerts. */
export async function unregisterPushDeviceAction (token: string): Promise<void> {
    await unregisterPushDevice(token).catch(() => undefined)
}
