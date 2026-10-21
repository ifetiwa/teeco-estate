'use client'

import { useEffect } from 'react'

/**
 * Keeps the phone's screen on while this page is open (security dashboard, gate console), so a guard doesn't miss
 * an alert because the phone went to sleep. Silently does nothing where the browser doesn't support it.
 */
export function KeepAwake () {
    useEffect(() => {
        let lock: { release (): Promise<void> } | null = null
        const nav = navigator as Navigator & { wakeLock?: { request (type: 'screen'): Promise<{ release (): Promise<void> }> } }
        const acquire = () => {
            if (document.visibilityState === 'visible') nav.wakeLock?.request('screen').then(l => { lock = l }).catch(() => { /* not allowed */ })
        }
        acquire()
        // The lock is dropped when the page is hidden; take it again when the guard comes back
        document.addEventListener('visibilitychange', acquire)
        return () => {
            document.removeEventListener('visibilitychange', acquire)
            void lock?.release().catch(() => undefined)
        }
    }, [])
    return null
}
