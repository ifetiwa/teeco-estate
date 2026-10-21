'use client'

import {
    Banknote, Bell, Building2, DoorOpen, House, LayoutDashboard, type LucideIcon, Phone, QrCode, ScrollText, ShieldCheck, Siren, Users,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

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

const ALERTS = (unread: number): Tab => ({ href: '/notifications', label: 'Alerts', icon: Bell, badge: unread, exact: true })

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

/** Which dashboard a menu belongs to. Each of the four dashboards has its own menu. */
type Dashboard =
    | { kind: 'platform' }
    | { kind: 'estate', estateId: string }
    | { kind: 'security', estateId: string }
    | { kind: 'resident', occupancyId: string }

const LAST_DASHBOARD_KEY = 'myestate:lastDashboard'

/** The dashboard a page belongs to, or null for pages shared by everyone (/app, /notifications). */
function dashboardForPath (path: string, t: NavTargets): Dashboard | null {
    const id = (prefix: string) => (path.startsWith(prefix) ? path.slice(prefix.length).split('/')[0] : null)
    if (path.startsWith('/platform')) return t.isPlatformAdmin ? { kind: 'platform' } : null
    const sec = id('/security/') ?? id('/gate/')
    if (sec) return { kind: 'security', estateId: sec }
    const est = id('/estate/')
    if (est) {
        // Guards only use the estate pages their security menu links to; keep them on that menu
        const roles = t.estates.find(e => e.id === est)?.roles ?? []
        return roles.length > 0 && roles.every(r => r === 'guard') ? { kind: 'security', estateId: est } : { kind: 'estate', estateId: est }
    }
    const home = id('/home/')
    return home ? { kind: 'resident', occupancyId: home } : null
}

/** Whether the person can still use a remembered dashboard (roles change, people move out). */
function stillAllowed (d: Dashboard, t: NavTargets): boolean {
    switch (d.kind) {
        case 'platform': return t.isPlatformAdmin
        case 'estate': return t.estates.some(e => e.id === d.estateId && e.roles.some(r => r !== 'guard'))
        case 'security': return t.estates.some(e => e.id === d.estateId && e.roles.some(r => r === 'guard' || r === 'estate_admin'))
        case 'resident': return t.homes.some(h => h.occupancyId === d.occupancyId)
    }
}

/** The person's main dashboard, for shared pages when they haven't opened one yet. */
function mainDashboard (t: NavTargets): Dashboard | null {
    if (t.isPlatformAdmin) return { kind: 'platform' }
    const admin = t.estates.find(e => e.roles.some(r => r !== 'guard'))
    if (admin) return { kind: 'estate', estateId: admin.id }
    const guard = t.estates.find(e => e.roles.includes('guard'))
    if (guard) return { kind: 'security', estateId: guard.id }
    return t.homes[0] ? { kind: 'resident', occupancyId: t.homes[0].occupancyId } : null
}

function tabsFor (d: Dashboard, t: NavTargets, unread: number): Tab[] {
    switch (d.kind) {
        case 'platform': return platformTabs(unread)
        case 'estate': return estateTabs(d.estateId, t.estates.find(e => e.id === d.estateId)?.roles ?? [], unread)
        case 'security': return securityTabs(d.estateId, unread)
        case 'resident': return residentTabs(d.occupancyId, unread)
    }
}

export function BottomNav ({ targets, unread }: { targets: NavTargets, unread: number }) {
    const path = usePathname()
    const fromPath = dashboardForPath(path, targets)
    const [remembered, setRemembered] = useState<Dashboard | null>(null)

    // On a dashboard page, remember it; on shared pages (/app, Alerts), keep showing the last dashboard's menu
    useEffect(() => {
        try {
            if (fromPath) {
                sessionStorage.setItem(LAST_DASHBOARD_KEY, JSON.stringify(fromPath))
                return
            }
            const saved = JSON.parse(sessionStorage.getItem(LAST_DASHBOARD_KEY) ?? 'null') as Dashboard | null
            setRemembered(saved && stillAllowed(saved, targets) ? saved : null)
        } catch { /* storage unavailable */ }
    }, [path]) // eslint-disable-line react-hooks/exhaustive-deps

    const dashboard = fromPath ?? remembered ?? mainDashboard(targets)
    if (!dashboard) return null
    const tabs = tabsFor(dashboard, targets, unread)
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
