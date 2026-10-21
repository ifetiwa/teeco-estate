import { Bell, LogOut, ShieldCheck } from 'lucide-react'
import Link from 'next/link'

import { signOutAction } from '@/app/signin/actions'
import { Logo } from '@/components/Logo'
import { BottomNav } from '@/components/BottomNav'
import { Avatar } from '@/components/ui'
import { getNavTargets } from '@/lib/estates'
import { countUnreadNotifications } from '@/lib/notifications'
import { formatNigerianPhone } from '@/lib/phone'

export async function AppHeader ({ user }: { user: { id: string, name: string, phone: string, isPlatformAdmin: boolean } }) {
    const actor = { userId: user.id, isPlatformAdmin: user.isPlatformAdmin }
    const [unread, navTargets] = await Promise.all([countUnreadNotifications(actor), getNavTargets(actor)])
    const display = user.name || formatNigerianPhone(user.phone)
    return (
        <>
        <BottomNav targets={navTargets} unread={unread} />
        <header className='sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur'>
            <div className='mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4'>
                <Logo href='/app' />
                <div className='flex items-center gap-1 sm:gap-2'>
                    {user.isPlatformAdmin && (
                        <Link href='/platform' className='btn-ghost px-3'>
                            <ShieldCheck className='h-4 w-4' aria-hidden /> <span className='hidden sm:inline'>Platform</span>
                            <span className='sr-only sm:hidden'>Platform</span>
                        </Link>
                    )}
                    <Link href='/app#notifications' className='btn-ghost relative px-3' aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
                        <Bell className='h-5 w-5' aria-hidden />
                        {unread > 0 && <span className='absolute top-1 right-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white'>{unread > 9 ? '9+' : unread}</span>}
                    </Link>
                    <div className='hidden items-center gap-2 pl-2 sm:flex'>
                        <Avatar name={display} size='sm' />
                        <span className='max-w-40 truncate text-sm font-medium text-slate-700'>{display}</span>
                    </div>
                    <form action={signOutAction}>
                        <button type='submit' className='btn-ghost px-3' aria-label='Sign out'>
                            <LogOut className='h-4 w-4' aria-hidden /> <span className='hidden md:inline'>Sign out</span>
                        </button>
                    </form>
                </div>
            </div>
        </header>
        </>
    )
}
