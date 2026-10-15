'use client'

import { DoorOpen, LayoutDashboard, MapPin, ScrollText, Settings, UserCog, Users } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const ICONS = {
    overview: LayoutDashboard,
    units: MapPin,
    residents: Users,
    visitors: ScrollText,
    gate: DoorOpen,
    staff: UserCog,
    settings: Settings,
} as const

export interface NavItem { href: string, label: string, icon: keyof typeof ICONS, exact?: boolean }

function isActive (pathname: string, item: NavItem) {
    return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + '/')
}

/** Sidebar on large screens; scrollable pill tabs on phones. */
export function EstateNav ({ items }: { items: NavItem[] }) {
    const pathname = usePathname()
    return (
        <>
            <nav aria-label='Estate' className='-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden'>
                {items.map(item => {
                    const Icon = ICONS[item.icon]
                    const active = isActive(pathname, item)
                    return (
                        <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}
                            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition ${active ? 'bg-brand-700 text-white shadow-sm' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
                            <Icon className='h-4 w-4' aria-hidden /> {item.label}
                        </Link>
                    )
                })}
            </nav>
            <nav aria-label='Estate' className='hidden lg:block'>
                <ul className='space-y-1'>
                    {items.map(item => {
                        const Icon = ICONS[item.icon]
                        const active = isActive(pathname, item)
                        return (
                            <li key={item.href}>
                                <Link href={item.href} aria-current={active ? 'page' : undefined}
                                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${active ? 'bg-brand-700 text-white shadow-sm' : 'text-slate-700 hover:bg-white hover:shadow-sm'}`}>
                                    <Icon className='h-5 w-5' aria-hidden /> {item.label}
                                </Link>
                            </li>
                        )
                    })}
                </ul>
            </nav>
        </>
    )
}
