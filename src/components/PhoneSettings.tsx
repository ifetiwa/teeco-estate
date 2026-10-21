'use client'

import { BellRing, Fingerprint, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'

import { biometricPlugin, isNativeApp, pushPlugin, storage } from '@/lib/native'

/** "This phone" settings, shown only inside the Android app: fingerprint lock and push status. */
export function PhoneSettings () {
    const [native, setNative] = useState(false)
    const [bioAvailable, setBioAvailable] = useState(false)
    const [lock, setLock] = useState(false)
    const [message, setMessage] = useState<string | null>(null)

    useEffect(() => {
        if (!isNativeApp()) return
        setNative(true)
        setLock(storage.appLock)
        biometricPlugin()?.isAvailable().then(r => setBioAvailable(r.isAvailable)).catch(() => setBioAvailable(false))
    }, [])

    if (!native) return null

    async function toggleLock () {
        const bio = biometricPlugin()
        if (!bio) return
        try {
            // Confirm it's really the owner before changing the lock either way
            await bio.verifyIdentity({ title: lock ? 'Turn off fingerprint lock' : 'Turn on fingerprint lock', negativeButtonText: 'Cancel', useFallback: true })
            storage.appLock = !lock
            setLock(!lock)
            setMessage(!lock ? 'The app will ask for your fingerprint when it opens.' : 'Fingerprint lock is off.')
        } catch {
            setMessage('Not changed.')
        }
    }

    return (
        <section className='card'>
            <h2 className='mb-3 flex items-center gap-2 font-semibold'><Smartphone className='h-5 w-5 text-brand-700' aria-hidden /> This phone</h2>
            <div className='space-y-3 text-sm'>
                <div className='flex items-center justify-between gap-3'>
                    <span className='flex items-center gap-2'><Fingerprint className='h-5 w-5 text-slate-500' aria-hidden />
                        <span><span className='block font-medium'>Fingerprint lock</span><span className='text-slate-500'>{bioAvailable ? 'Ask for your fingerprint or face when the app opens' : 'Set up a fingerprint or face unlock on this phone first'}</span></span>
                    </span>
                    <button type='button' role='switch' aria-checked={lock} disabled={!bioAvailable} onClick={toggleLock}
                        className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-40 ${lock ? 'bg-brand-600' : 'bg-slate-300'}`}>
                        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${lock ? 'left-[22px]' : 'left-0.5'}`} />
                    </button>
                </div>
                <p className='flex items-center gap-2 text-slate-600'><BellRing className='h-5 w-5 text-slate-500' aria-hidden />
                    {pushPlugin() ? (storage.pushToken ? 'Push notifications are on for this phone.' : 'Allow notifications when asked to get alerts with the app closed.') : 'Push notifications are not available in this version of the app.'}
                </p>
                {message && <p role='status' className='rounded-lg bg-brand-50 px-3 py-2 text-brand-800'>{message}</p>}
            </div>
        </section>
    )
}
