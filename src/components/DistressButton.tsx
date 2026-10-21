'use client'

import { Siren } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { raiseDistressAction } from '@/app/home/[occupancyId]/actions'

const HOLD_MS = 2000
const GPS_TIMEOUT_MS = 6000

type Phase = 'idle' | 'holding' | 'locating' | 'sending'

/** Short vibration as feedback (phones only; ignored elsewhere). */
function buzz (pattern: number | number[]) {
    try { navigator.vibrate?.(pattern) } catch { /* not supported */ }
}

/** Best GPS fix the phone can give within a few seconds, or null (permission denied, no signal, desktop). */
function currentPosition (): Promise<{ latitude: number, longitude: number, accuracy: number } | null> {
    return new Promise((resolve) => {
        if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
        navigator.geolocation.getCurrentPosition(
            p => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
            () => resolve(null),
            { enableHighAccuracy: true, timeout: GPS_TIMEOUT_MS, maximumAge: 30_000 },
        )
    })
}

/**
 * The emergency button. Press and hold for 2 seconds (so a pocket tap doesn't set it off); it then takes the
 * phone's location, alerts the estate and opens the alert screen with the nearest police stations to call.
 */
export function DistressButton ({ occupancyId, compact = false }: { occupancyId: string, compact?: boolean }) {
    const router = useRouter()
    const [phase, setPhase] = useState<Phase>('idle')
    const [progress, setProgress] = useState(0)
    const [error, setError] = useState<string | null>(null)
    const started = useRef<number | null>(null)
    const frame = useRef<number | null>(null)

    useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current) }, [])

    async function fire () {
        setPhase('locating')
        const position = await currentPosition()
        setPhase('sending')
        const res = await raiseDistressAction(occupancyId, position)
        if (res.href) {
            router.push(res.href)
        } else {
            setError(res.error ?? 'Could not send the alert. Call 112 now.')
            setPhase('idle')
            setProgress(0)
        }
    }

    function tick () {
        if (started.current === null) return
        const p = Math.min(1, (performance.now() - started.current) / HOLD_MS)
        setProgress(p)
        if (p >= 1) {
            started.current = null
            buzz([200, 100, 200])
            void fire()
            return
        }
        frame.current = requestAnimationFrame(tick)
    }

    function start (e: React.PointerEvent | React.KeyboardEvent) {
        if (phase !== 'idle') return
        if ('key' in e && e.key !== 'Enter' && e.key !== ' ') return
        if ('key' in e && e.repeat) return
        e.preventDefault()
        setError(null)
        setPhase('holding')
        buzz(40)
        started.current = performance.now()
        frame.current = requestAnimationFrame(tick)
    }

    function stop () {
        if (phase !== 'holding') return
        started.current = null
        if (frame.current) cancelAnimationFrame(frame.current)
        setPhase('idle')
        setProgress(0)
    }

    const label = phase === 'locating' ? 'Getting your location…' : phase === 'sending' ? 'Alerting the estate…' : phase === 'holding' ? 'Keep holding…' : 'Hold for 2 seconds'
    const busy = phase === 'locating' || phase === 'sending'

    return (
        <div className={compact ? '' : 'card border-red-200 bg-red-50/60'}>
            {!compact && (
                <div className='mb-3'>
                    <h2 className='text-base font-semibold text-red-800'>Emergency</h2>
                    <p className='text-sm text-red-700'>Alerts estate security and everyone in the estate, shares your location, and shows the nearest police stations to call.</p>
                </div>
            )}
            <button
                type='button'
                onPointerDown={start}
                onPointerUp={stop}
                onPointerLeave={stop}
                onPointerCancel={stop}
                onKeyDown={start}
                onKeyUp={stop}
                onContextMenu={e => e.preventDefault()}
                disabled={busy}
                aria-label='Emergency button. Press and hold for 2 seconds to alert security.'
                className='relative w-full touch-none overflow-hidden rounded-2xl bg-red-600 px-5 py-5 text-white shadow-lg ring-4 ring-red-200 transition select-none active:scale-[0.99] disabled:opacity-90'
            >
                <span aria-hidden className='absolute inset-y-0 left-0 bg-red-800' style={{ width: `${progress * 100}%` }} />
                <span className='relative flex items-center justify-center gap-3'>
                    <Siren className={`h-8 w-8 ${busy ? 'animate-pulse' : ''}`} aria-hidden />
                    <span className='text-left'>
                        <span className='block text-xl font-extrabold tracking-wide'>EMERGENCY</span>
                        <span className='block text-sm font-medium text-red-100'>{label}</span>
                    </span>
                </span>
            </button>
            {error && <p role='alert' className='mt-3 rounded-lg bg-white px-3 py-2 text-sm font-medium text-red-700 ring-1 ring-red-200'>{error}</p>}
        </div>
    )
}
