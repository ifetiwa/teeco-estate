'use client'

import { useEffect } from 'react'

/**
 * Beeps (and vibrates, on phones that allow it) while an alert nobody has taken is open.
 * Browsers only allow sound after the page has been tapped once, which a guard on the gate console will have done.
 */
export function AlarmSound ({ ringing }: { ringing: boolean }) {
    useEffect(() => {
        if (!ringing) return
        let ctx: AudioContext | null = null
        const beep = () => {
            try {
                ctx ??= new AudioContext()
                const osc = ctx.createOscillator()
                const gain = ctx.createGain()
                osc.type = 'square'
                osc.frequency.value = 880
                gain.gain.value = 0.15
                osc.connect(gain).connect(ctx.destination)
                osc.start()
                osc.stop(ctx.currentTime + 0.4)
            } catch { /* audio not available */ }
            try { navigator.vibrate?.([300, 150, 300]) } catch { /* not supported */ }
        }
        beep()
        const t = setInterval(beep, 2500)
        return () => {
            clearInterval(t)
            void ctx?.close()
        }
    }, [ringing])
    return null
}
