'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Opens the phone's dialer on the nearest police number once per alert, and keeps the alert status fresh.
 * Browsers never place a call by themselves: the dialer opens with the number ready and the resident taps call.
 */
export function AutoDial ({ alertId, number, active }: { alertId: string, number: string | null, active: boolean }) {
    const router = useRouter()

    useEffect(() => {
        if (!active || !number) return
        const key = `dialled:${alertId}`
        try {
            if (sessionStorage.getItem(key)) return
            sessionStorage.setItem(key, '1')
        } catch { /* storage unavailable: still dial once for this page view */ }
        // Only phones have a dialer; on a computer this would just show an "open app" prompt
        if (!/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return
        const t = setTimeout(() => { window.location.href = `tel:${number}` }, 600)
        return () => clearTimeout(t)
    }, [alertId, number, active])

    useEffect(() => {
        if (!active) return
        const t = setInterval(() => router.refresh(), 10_000)
        return () => clearInterval(t)
    }, [router, active])

    return null
}
