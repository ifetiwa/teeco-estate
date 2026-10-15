import { CheckCircle2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { Logo } from '@/components/Logo'

/** Two-panel layout for sign-in screens: brand panel on large screens, centred card on phones. */
export function AuthShell ({ children }: { children: ReactNode }) {
    return (
        <main className='grid min-h-[calc(100vh-6rem)] lg:grid-cols-2'>
            <div className='relative hidden overflow-hidden bg-gradient-to-br from-brand-900 to-brand-600 p-10 text-white lg:flex lg:flex-col lg:justify-between'>
                <div aria-hidden className='absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-accent-500/20 blur-3xl' />
                <Logo inverted />
                <div className='relative'>
                    <h2 className='text-3xl font-bold'>Your estate, in your pocket</h2>
                    <ul className='mt-6 space-y-3 text-brand-100'>
                        {['Share visitor codes in seconds', 'Pay levies and get receipts', 'Report issues and follow them to the end'].map(t => (
                            <li key={t} className='flex items-center gap-2'><CheckCircle2 className='h-5 w-5 text-accent-400' aria-hidden /> {t}</li>
                        ))}
                    </ul>
                </div>
                <p className='relative text-sm text-brand-200'>Secure sign-in with a code sent to your phone.</p>
            </div>
            <div className='flex items-center justify-center px-4 py-10'>
                <div className='w-full max-w-sm'>
                    <div className='mb-8 lg:hidden'><Logo /></div>
                    {children}
                </div>
            </div>
        </main>
    )
}
