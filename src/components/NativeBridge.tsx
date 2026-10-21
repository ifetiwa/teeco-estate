'use client'

import { Fingerprint } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { registerPushDeviceAction } from '@/app/device/actions'
import { biometricPlugin, pushPlugin, storage } from '@/lib/native'

/** Lock again when the app comes back after this long in the background. */
const RELOCK_AFTER_MS = 2 * 60_000
const UNLOCKED_KEY = 'myestate:unlocked'

/**
 * Native features of the Android app, for signed-in pages: registers the phone for push notifications, opens the
 * right page when a notification is tapped, and shows the fingerprint lock if the user turned it on.
 * Renders nothing in a normal browser.
 */
export function NativeBridge () {
    const router = useRouter()
    const [locked, setLocked] = useState(false)
    const hiddenAt = useRef<number | null>(null)

    // Push: ask once, register, and keep the server's copy of the token current
    useEffect(() => {
        const push = pushPlugin()
        if (!push) return
        const listeners: Array<Promise<{ remove (): Promise<void> }>> = []
        void (async () => {
            await push.createChannel({ id: 'emergency', name: 'Emergencies', description: 'SOS alerts in your estate', importance: 5, sound: 'default', vibration: true, visibility: 1 })
            await push.createChannel({ id: 'general', name: 'Estate updates', description: 'Visitors, payments and notices', importance: 3 })
            listeners.push(push.addListener('registration', (t) => {
                storage.pushToken = t.value
                void registerPushDeviceAction(t.value)
            }))
            listeners.push(push.addListener('pushNotificationActionPerformed', (a) => {
                const link = a.notification.data?.link
                if (link?.startsWith('/')) router.push(link)
            }))
            let { receive } = await push.checkPermissions()
            if (receive === 'prompt' || receive === 'prompt-with-rationale') receive = (await push.requestPermissions()).receive
            if (receive === 'granted') await push.register()
        })().catch(e => console.error('[push]', e))
        return () => { listeners.forEach(l => void l.then(x => x.remove())) }
    }, [router])

    const unlock = useCallback(async () => {
        const bio = biometricPlugin()
        if (!bio) { setLocked(false); return }
        try {
            await bio.verifyIdentity({ title: 'Unlock MyEstateapp', subtitle: 'Use your fingerprint or face', negativeButtonText: 'Cancel', useFallback: true })
            try { sessionStorage.setItem(UNLOCKED_KEY, '1') } catch { /* unavailable */ }
            setLocked(false)
        } catch { /* stays locked; the button tries again */ }
    }, [])

    // Fingerprint lock: when the app opens, and when it returns after a while in the background
    useEffect(() => {
        if (!storage.appLock || !biometricPlugin()) return
        let unlocked = false
        try { unlocked = sessionStorage.getItem(UNLOCKED_KEY) === '1' } catch { /* unavailable */ }
        if (!unlocked) { setLocked(true); void unlock() }
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') { hiddenAt.current = Date.now(); return }
            if (hiddenAt.current && Date.now() - hiddenAt.current > RELOCK_AFTER_MS) {
                try { sessionStorage.removeItem(UNLOCKED_KEY) } catch { /* unavailable */ }
                setLocked(true)
                void unlock()
            }
        }
        document.addEventListener('visibilitychange', onVisibility)
        return () => document.removeEventListener('visibilitychange', onVisibility)
    }, [unlock])

    if (!locked) return null
    return (
        <div role='dialog' aria-label='App locked' className='fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-brand-800 px-6 text-center text-white'>
            <Fingerprint className='h-20 w-20' aria-hidden />
            <div>
                <p className='text-2xl font-bold'>MyEstateapp is locked</p>
                <p className='mt-1 text-brand-100'>Unlock with your fingerprint or face.</p>
            </div>
            <button type='button' onClick={() => void unlock()} className='rounded-xl bg-white px-6 py-3 text-lg font-semibold text-brand-800'>Unlock</button>
        </div>
    )
}
