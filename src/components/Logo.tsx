import Link from 'next/link'
import { useId } from 'react'

import { BRAND } from '@/config/brand'

export function LogoMark ({ className = 'h-9 w-9' }: { className?: string }) {
    // Unique per logo: a page can show two (one hidden on phones), and a gradient defined inside a hidden one doesn't render
    const gradientId = `mea-g-${useId().replace(/:/g, '')}`
    return (
        <svg viewBox='0 0 64 64' className={className} aria-hidden='true'>
            <defs>
                <linearGradient id={gradientId} x1='0' y1='0' x2='1' y2='1'>
                    <stop offset='0' stopColor='#198754' />
                    <stop offset='1' stopColor='#0a3622' />
                </linearGradient>
            </defs>
            <rect width='64' height='64' rx='16' fill={`url(#${gradientId})`} />
            <path d='M33 27 43 18.5 53 27v22H33z' fill='#8fd1a8' />
            <path d='M11 33.5 25.5 21 40 33.5V49H11z' fill='#ffffff' />
            <path d='M21.5 49v-8a4 4 0 0 1 8 0v8z' fill='#d4a017' />
            <rect x='44' y='34' width='5' height='5' rx='1' fill='#0f5132' opacity='0.55' />
            <circle cx='48' cy='12.5' r='3.5' fill='#d4a017' />
        </svg>
    )
}

/** MyEstateapp logo: the mark (two homes, gold door and sun; see mobile/scripts/make-icons.mjs) and the name. */
export function Logo ({ href = '/', inverted = false }: { href?: string, inverted?: boolean }) {
    return (
        <Link href={href} className={`flex items-center gap-2.5 text-lg font-bold tracking-tight ${inverted ? 'text-white' : 'text-brand-800'}`}>
            <LogoMark />
            <span>{BRAND.productName}</span>
        </Link>
    )
}
