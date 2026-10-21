'use client'

import {
    Banknote, Bell, Building2, DoorOpen, House, LayoutDashboard, type LucideIcon, Phone, QrCode, ScrollText, ShieldCheck, Siren, Users,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import type { NavTargets } from '@/lib/estates'

interface Tab {
    href: string
    label: string
    icon: LucideIcon
    /** Active when the path equals href (otherwise when it starts with it) */
    exact?: boolean
    /** The big red centre button */
    sos?: boolean
    badge?: number
}

const ALERTS = (unread: number): Tab => ({ href: '/app#notifications', label: 'Alerts', icon: Bell, badge: unread, exact: true })

function platformTabs (unread: number): Tab[] {
    return [
        { href: '/app', label: 'Home', icon: House, exact: true },
        { href: '/platform', label: 'Estates', icon: Building2, exact: true },
        { href: '/platform#emergencies', label: 'SOS', icon: Siren, sos: true },
        { href: '/platform#police', label: 'Police', icon: Phone },
        ALERTS(unread),
    ]
}

function estateTabs (estateId: string, roles: string[], unread: number): Tab[] {
    const base = `/estate/${estateId}`
    const tabs: Tab[] = [
        { href: base, label: 'Overview', icon: LayoutDashboard, exact: true },
        { href: `${base}/residents`, label: 'Residents', icon: Users },
        { href: `${base}/payments`, label: 'Payments', icon: Banknote },
    ]
    if (roles.includes('estate_admin')) tabs.push({ href: `/security/${estateId}`, label: 'Security', icon: ShieldCheck })
    return [...tabs, ALERTS(unread)]
}

function securityTabs (estateId: string, unread: number): Tab[] {
    return [
        { href: `/security/${estateId}`, label: 'Security', icon: ShieldCheck },
        { href: `/gate/${estateId}`, label: 'Gate', icon: DoorOpen },
        { href: `/estate/${estateId}/emergencies`, label: 'SOS log', icon: Siren, sos: true },
        { href: `/estate/${estateId}/visitors`, label: 'Visitors', icon: ScrollText },
        ALERTS(unread),
    ]
}

function residentTabs (occupancyId: string, unread: number): Tab[] {
    const base = `/home/${occupancyId}`
    return [
        { href: base, label: 'Home', icon: House, exact: true },
        { href: `${base}/passes`, label: 'Passes', icon: QrCode },
        { href: `${base}#emergency`, label: 'SOS', icon: Siren, sos: true },
        { href: `${base}/payments`, label: 'Payments', icon: Banknote },
        ALERTS(unread),
    ]
}

/** Picks the menu for the page being viewed, so someone with several roles gets the right tabs in each area. */
function tabsFor (path: string, t: NavTargets, unread: number): Tab[] | null {
    const id = (prefix: string) => (path.startsWith(prefix) ? path.slice(prefix.length).split('/')[0] : null)
    const estateRoles = (estateId: string) => t.estates.find(e => e.id === estateId)?.roles ?? []

    if (path.startsWith('/platform') && t.isPlatformAdmin) return platformTabs(unread)
    const sec = id('/security/') ?? id('/gate/')
    if (sec) return securityTabs(sec, unread)
    const est = id('/estate/')
    if (est) {
        const roles = estateRoles(est)
        return roles.length === 1 && roles[0] === 'guard' ? securityTabs(est, unread) : estateTabs(est, roles, unread)
    }
    const home = id('/home/')
    if (home) return residentTabs(home, unread)

    // Anywhere else (e.g. /app): the person's main role
    if (t.isPlatformAdmin) return platformTabs(unread)
    const admin = t.estates.find(e => e.roles.some(r => r !== 'guard'))
    if (admin) return estateTabs(admin.id, admin.roles, unread)
    const guard = t.estates.find(e => e.roles.includes('guard'))
    if (guard) return securityTabs(guard.id, unread)
    if (t.homes[0]) return residentTabs(t.homes[0].occupancyId, unread)
    return null
}

/** Fixed tab bar at the bottom of the screen on phones and tablets (hidden on desktop, which has the side menu). */
export function BottomNav ({ targets, unread }: { targets: NavTargets, unread: number }) {
    const path = usePathname()
    const tabs = tabsFor(path, targets, unread)
    if (!tabs) return null
    const isActive = (t: Tab) => {
        const href = t.href.split('#')[0]
        if (t.href.includes('#') && href === path) return false // in-page shortcuts never take over their page's tab
        return t.exact ? path === href : path === href || path.startsWith(href + '/')
    }

    return (
        <nav aria-label='Main' className='bottom-nav fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgb(15_23_42/0.06)] backdrop-blur lg:hidden'>
            <ul className='mx-auto grid max-w-lg grid-cols-5'>
                {tabs.map(t => {
                    const active = isActive(t)
                    const Icon = t.icon
                    if (t.sos) {
                        return (
                            <li key={t.href} className='flex justify-center'>
                                <Link href={t.href} aria-label={t.label} className='-mt-5 flex flex-col items-center gap-0.5'>
                                    <span className='grid h-14 w-14 place-items-center rounded-full bg-red-600 text-white shadow-lg ring-4 ring-white active:scale-95'>
                                        <Icon className='h-7 w-7' aria-hidden />
                                    </span>
                                    <span className='text-[11px] font-bold text-red-700'>{t.label}</span>
                                </Link>
                            </li>
                        )
                    }
                    return (
                        <li key={t.href}>
                            <Link href={t.href} aria-current={active ? 'page' : undefined}
                                className={`relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium ${active ? 'text-brand-700' : 'text-slate-500'}`}>
                                {active && <span className='absolute top-0 h-0.5 w-8 rounded-full bg-brand-700' aria-hidden />}
                                <Icon className='h-6 w-6' aria-hidden />
                                {t.label}
                                {!!t.badge && <span className='absolute top-2 left-1/2 ml-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white'>{t.badge > 9 ? '9+' : t.badge}</span>}
                            </Link>
                        </li>
                    )
                })}
            </ul>
        </nav>
    )
}
