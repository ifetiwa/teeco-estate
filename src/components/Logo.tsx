import Link from 'next/link'

import { BRAND } from '@/config/brand'

/** Placeholder logo until the owner supplies artwork. */
export function Logo ({ href = '/' }: { href?: string }) {
    return (
        <Link href={href} className='flex items-center gap-2 font-semibold text-brand-800'>
            <svg viewBox='0 0 64 64' className='h-8 w-8' aria-hidden='true'>
                <rect width='64' height='64' rx='14' fill='#0f5132' />
                <path d='M14 32 32 16l18 16v18H38V38H26v12H14z' fill='#ffffff' />
                <circle cx='32' cy='29' r='4' fill='#d4a017' />
            </svg>
            <span>{BRAND.productName}</span>
        </Link>
    )
}
