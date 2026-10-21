'use client'

import { LogOut } from 'lucide-react'

import { unregisterPushDeviceAction } from '@/app/device/actions'
import { storage } from '@/lib/native'

/** Signs out; in the Android app it first stops this phone receiving the user's push alerts. */
export function SignOutButton ({ action }: { action: () => Promise<void> }) {
    return (
        <form action={async () => {
            const token = storage.pushToken
            if (token) {
                await unregisterPushDeviceAction(token)
                storage.pushToken = null
            }
            await action()
        }}>
            <button type='submit' className='btn-ghost px-3' aria-label='Sign out'>
                <LogOut className='h-4 w-4' aria-hidden /> <span className='hidden md:inline'>Sign out</span>
            </button>
        </form>
    )
}
