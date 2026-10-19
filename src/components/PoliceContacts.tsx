import { Phone, ShieldCheck } from 'lucide-react'

import { formatDialNumber } from '@/lib/emergency'

interface Station {
    id: string
    name: string
    area: string
    phone: string | null
    altPhone: string | null
    distanceKm: number | null
    isEstateDivision?: boolean
    verifiedAt: Date | null
}

/**
 * Police numbers to call, as large tap-to-call rows: the estate's own division first, other nearby stations, then the
 * FCT Command and national emergency lines. `urgent` makes the first callable number red (for a live alert).
 */
export function PoliceContacts ({ stations, lines, urgent = false }: {
    stations: Station[]
    lines: ReadonlyArray<{ label: string, number: string }>
    urgent?: boolean
}) {
    const firstCallable = stations.find(s => s.phone)?.id ?? (stations.length === 0 || !stations.some(s => s.phone) ? lines[0]?.number : undefined)
    const row = (highlight: boolean) => `flex items-center gap-3 rounded-xl px-4 py-3 ring-1 transition ${highlight && urgent
        ? 'bg-red-600 text-white ring-red-600 hover:bg-red-700'
        : 'bg-white ring-slate-200 hover:bg-slate-50'}`
    const muted = (highlight: boolean) => (highlight && urgent ? 'text-red-100' : 'text-slate-500')

    return (
        <ul className='space-y-2'>
            {stations.map((s) => {
                const highlight = s.id === firstCallable
                const meta = [s.isEstateDivision ? 'Your estate\'s division' : null, s.area, s.distanceKm !== null ? `${s.distanceKm.toFixed(1)} km away` : null].filter(Boolean).join(' · ')
                return (
                    <li key={s.id}>
                        {s.phone
                            ? (
                                <a href={`tel:${s.phone}`} className={row(highlight)}>
                                    <Phone className='h-5 w-5 shrink-0' aria-hidden />
                                    <span className='min-w-0 flex-1'>
                                        <span className='block font-semibold'>{s.name}</span>
                                        <span className={`block text-sm ${muted(highlight)}`}>{meta}</span>
                                    </span>
                                    <span className='font-mono text-sm font-semibold whitespace-nowrap'>{formatDialNumber(s.phone)}</span>
                                </a>
                            )
                            : (
                                <div className='flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200'>
                                    <ShieldCheck className='h-5 w-5 shrink-0 text-slate-400' aria-hidden />
                                    <span className='min-w-0 flex-1'>
                                        <span className='block font-semibold'>{s.name}</span>
                                        <span className='block text-sm text-slate-500'>{meta}</span>
                                        <span className='block text-xs text-slate-500'>No direct line published. Use the FCT Command lines below.</span>
                                    </span>
                                </div>
                            )}
                        {s.altPhone && <a href={`tel:${s.altPhone}`} className='mt-1 block pl-12 text-sm font-medium text-brand-700 hover:underline'>Other line: {formatDialNumber(s.altPhone)}</a>}
                    </li>
                )
            })}
            {lines.map(l => (
                <li key={l.number}>
                    <a href={`tel:${l.number}`} className={row(l.number === firstCallable)}>
                        <Phone className='h-5 w-5 shrink-0' aria-hidden />
                        <span className='flex-1 font-semibold'>{l.label}</span>
                        <span className='font-mono text-base font-bold whitespace-nowrap'>{formatDialNumber(l.number)}</span>
                    </a>
                </li>
            ))}
        </ul>
    )
}
