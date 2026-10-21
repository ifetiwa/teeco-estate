'use client'

import { Download, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'

interface CapacitorShare { share (o: { title?: string, text?: string, dialogTitle?: string }): Promise<unknown> }
type CapacitorWindow = Window & { Capacitor?: { isNativePlatform?: () => boolean, Plugins?: { Share?: CapacitorShare } } }

/** Turns the pass's QR SVG into a PNG file (white margin, ready to show at the gate). */
async function qrPng (svg: string, fileName: string): Promise<File> {
    const img = new Image()
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    await img.decode()
    const size = 720
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)
    ctx.drawImage(img, 40, 40, size - 80, size - 80)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('png'))), 'image/png'))
    return new File([blob], fileName, { type: 'image/png' })
}

/**
 * Share the pass through the phone's share sheet: with the QR picture where the browser allows it (Android Chrome,
 * iPhone Safari), as text in the Android app. "Save QR" downloads the picture to send any other way.
 */
export function SharePass ({ text, qrSvg, fileName }: { text: string, qrSvg: string, fileName: string }) {
    const [mode, setMode] = useState<'native' | 'web' | null>(null)
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        const w = window as CapacitorWindow
        if (w.Capacitor?.isNativePlatform?.() && w.Capacitor.Plugins?.Share) setMode('native')
        else if (typeof navigator.share === 'function') setMode('web')
    }, [])

    async function share () {
        setBusy(true)
        try {
            const w = window as CapacitorWindow
            if (mode === 'native') {
                await w.Capacitor!.Plugins!.Share!.share({ title: 'Gate pass', text, dialogTitle: 'Send the gate pass' })
                return
            }
            const file = await qrPng(qrSvg, fileName).catch(() => null)
            const withFile = file && navigator.canShare?.({ files: [file] }) ? { files: [file] } : {}
            await navigator.share({ title: 'Gate pass', text, ...withFile })
        } catch { /* the person closed the share sheet */ } finally {
            setBusy(false)
        }
    }

    async function save () {
        const file = await qrPng(qrSvg, fileName)
        const url = URL.createObjectURL(file)
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
    }

    // Downloads don't work inside the Android app's web view, so the app offers sharing only
    if (mode === 'native') {
        return <button type='button' onClick={share} disabled={busy} className='btn-primary w-full py-3'><Share2 className='h-4 w-4' aria-hidden />Share pass</button>
    }
    return (
        <div className='grid grid-cols-2 gap-2'>
            {mode === 'web' && <button type='button' onClick={share} disabled={busy} className='btn-primary py-3'><Share2 className='h-4 w-4' aria-hidden />Share pass</button>}
            <button type='button' onClick={save} className={`btn-secondary py-3 ${mode ? '' : 'col-span-2'}`}><Download className='h-4 w-4' aria-hidden />Save QR</button>
        </div>
    )
}
