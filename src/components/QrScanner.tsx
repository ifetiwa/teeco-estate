'use client'

import jsQR from 'jsqr'
import { Camera, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

/**
 * "Scan QR code" button that opens the phone's back camera full-screen and calls onResult with the first QR code it
 * reads. Works in the Android app and in mobile browsers (the page must be served over https).
 */
export function QrScanner ({ onResult, label = 'Scan QR code' }: { onResult: (text: string) => void, label?: string }) {
    const [open, setOpen] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const video = useRef<HTMLVideoElement>(null)
    const canvas = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        if (!open) return
        let stream: MediaStream | null = null
        let frame = 0
        let stopped = false

        const scan = () => {
            if (stopped) return
            const v = video.current
            const c = canvas.current
            if (v && c && v.readyState === v.HAVE_ENOUGH_DATA) {
                // Decode a scaled-down frame: fast enough on low-end phones and plenty for a pass QR
                const scale = Math.min(1, 640 / v.videoWidth)
                c.width = Math.round(v.videoWidth * scale)
                c.height = Math.round(v.videoHeight * scale)
                const ctx = c.getContext('2d', { willReadFrequently: true })!
                ctx.drawImage(v, 0, 0, c.width, c.height)
                const code = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: 'dontInvert' })
                if (code?.data) {
                    try { navigator.vibrate?.(80) } catch { /* not supported */ }
                    setOpen(false)
                    onResult(code.data)
                    return
                }
            }
            frame = requestAnimationFrame(scan)
        }

        navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
            .then((s) => {
                if (stopped) { s.getTracks().forEach(t => t.stop()); return }
                stream = s
                if (video.current) {
                    video.current.srcObject = s
                    void video.current.play()
                }
                frame = requestAnimationFrame(scan)
            })
            .catch(() => setError('Could not open the camera. Allow camera access for this app, or type the 6-digit code.'))

        return () => {
            stopped = true
            cancelAnimationFrame(frame)
            stream?.getTracks().forEach(t => t.stop())
        }
    }, [open, onResult])

    return (
        <>
            <button type='button' onClick={() => { setError(null); setOpen(true) }} className='btn-secondary w-full py-3 text-lg'>
                <Camera className='h-5 w-5' aria-hidden /> {label}
            </button>
            {error && !open && <p role='alert' className='mt-2 text-sm font-medium text-red-700'>{error}</p>}
            {open && (
                <div role='dialog' aria-label='Scan QR code' className='fixed inset-0 z-50 flex flex-col bg-black'>
                    <div className='relative flex-1 overflow-hidden'>
                        <video ref={video} playsInline muted className='h-full w-full object-cover' />
                        <div aria-hidden className='pointer-events-none absolute inset-0 grid place-items-center'>
                            <div className='h-64 w-64 rounded-3xl border-4 border-white/90 shadow-[0_0_0_9999px_rgb(0_0_0/0.45)]' />
                        </div>
                        <p className='absolute inset-x-0 top-6 text-center text-lg font-semibold text-white'>Point at the visitor&apos;s QR code</p>
                        {error && <p role='alert' className='absolute inset-x-4 bottom-6 rounded-xl bg-red-600 p-3 text-center text-white'>{error}</p>}
                    </div>
                    <canvas ref={canvas} className='hidden' />
                    <button type='button' onClick={() => setOpen(false)} className='flex items-center justify-center gap-2 bg-white py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-lg font-semibold'>
                        <X className='h-5 w-5' aria-hidden /> Cancel
                    </button>
                </div>
            )}
        </>
    )
}
