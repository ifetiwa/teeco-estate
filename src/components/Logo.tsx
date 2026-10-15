import Link from 'next/link'

import { BRAND } from '@/config/brand'

export function LogoMark ({ className = 'h-9 w-9' }: { className?: string }) {
    return (
        <svg viewBox='0 0 64 64' className={className} aria-hidden='true'>
            <defs>
                <linearGradient id='teeco-g' x1='0' y1='0' x2='1' y2='1'>
                    <stop offset='0' stopColor='#157347' />
                    <stop offset='1' stopColor='#0a3622' />
                </linearGradient>
            </defs>
            <rect width='64' height='64' rx='16' fill='url(#teeco-g)' />
            <path d='M14 33 32 17l18 16v17H38V39H26v11H14z' fill='#ffffff' />
            <circle cx='32' cy='30' r='4' fill='#d4a017' />
        </svg>
    )
}

/** Placeholder logo until the owner supplies artwork. */
export function Logo ({ href = '/', inverted = false }: { href?: string, inverted?: boolean }) {
    return (
        <Link href={href} className={`flex items-center gap-2.5 text-lg font-bold tracking-tight ${inverted ? 'text-white' : 'text-brand-800'}`}>
            <LogoMark />
            <span>{BRAND.productName}</span>
        </Link>
    )
}
