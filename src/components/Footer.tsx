import Link from 'next/link'

import { legalFooter } from '@/config/brand'
import { PLATFORM_DEFAULTS } from '@/config/defaults'
import { formatTime } from '@/lib/format'

export function Footer () {
    return (
        <footer className='mt-16 border-t border-slate-200 bg-white/60 py-6 text-center text-xs text-slate-500'>
            <p className='font-medium text-slate-600'>{legalFooter()}</p>
            <p className='mt-1'>
                Amounts in Naira ({PLATFORM_DEFAULTS.currency}) · Times in WAT ({PLATFORM_DEFAULTS.timezone}), now {formatTime(new Date())}
            </p>
            <p className='mt-1'>
                <Link href='/privacy' className='hover:underline'>Privacy policy</Link> · <Link href='/account/delete' className='hover:underline'>Delete your account</Link>
            </p>
        </footer>
    )
}
