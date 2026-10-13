import Link from 'next/link'

import { signOutAction } from '@/app/signin/actions'
import { Logo } from '@/components/Logo'
import { formatNigerianPhone } from '@/lib/phone'

export function AppHeader ({ user }: { user: { name: string, phone: string, isPlatformAdmin: boolean } }) {
    return (
        <header className='border-b border-slate-200 bg-white'>
            <div className='mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3'>
                <Logo href='/app' />
                <div className='flex items-center gap-3 text-sm'>
                    {user.isPlatformAdmin && <Link href='/platform' className='text-brand-700 underline'>Platform</Link>}
                    <span className='hidden text-slate-600 sm:inline'>{user.name || formatNigerianPhone(user.phone)}</span>
                    <form action={signOutAction}>
                        <button type='submit' className='btn-secondary px-3 py-1 text-sm'>Sign out</button>
                    </form>
                </div>
            </div>
        </header>
    )
}
