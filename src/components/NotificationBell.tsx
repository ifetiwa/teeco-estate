'use client'

import { Bell, CheckCheck, Siren } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { type NotificationItem, latestNotificationsAction, markAllReadAction, markNotificationReadAction } from '@/app/notifications/actions'

const lagosTime = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })

function when (iso: string): string {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins} min ago`
    if (mins < 24 * 60) return `${Math.floor(mins / 60)} h ago`
    return lagosTime.format(new Date(iso))
}

/** The header bell: opens a drop-down with the latest notifications, "Mark all read" and "See all". */
export function NotificationBell ({ unread: initialUnread }: { unread: number }) {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [items, setItems] = useState<NotificationItem[] | null>(null)
    const [unread, setUnread] = useState(initialUnread)
    const box = useRef<HTMLDivElement>(null)

    useEffect(() => setUnread(initialUnread), [initialUnread])

    const load = useCallback(async () => {
        const r = await latestNotificationsAction()
        setItems(r.items)
        setUnread(r.unread)
    }, [])

    useEffect(() => {
        if (!open) return
        void load()
        const onDown = (e: MouseEvent | TouchEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
        document.addEventListener('mousedown', onDown)
        document.addEventListener('touchstart', onDown)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onDown)
            document.removeEventListener('touchstart', onDown)
            document.removeEventListener('keydown', onKey)
        }
    }, [open, load])

    async function openItem (n: NotificationItem) {
        setOpen(false)
        if (!n.read) {
            await markNotificationReadAction(n.id)
            setUnread(u => Math.max(0, u - 1))
        }
        router.push(n.link ?? '/notifications')
        router.refresh()
    }

    async function markAll () {
        await markAllReadAction()
        setItems(list => list?.map(n => ({ ...n, read: true })) ?? null)
        setUnread(0)
        router.refresh()
    }

    return (
        <div ref={box} className='relative'>
            <button type='button' onClick={() => setOpen(o => !o)} className='btn-ghost relative px-3' aria-expanded={open} aria-haspopup='dialog'
                aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
                <Bell className='h-5 w-5' aria-hidden />
                {unread > 0 && <span className='absolute top-1 right-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white'>{unread > 9 ? '9+' : unread}</span>}
            </button>
            {open && (
                <div role='dialog' aria-label='Notifications'
                    className='fixed inset-x-2 top-16 z-50 overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 sm:absolute sm:inset-x-auto sm:top-12 sm:right-0 sm:w-96'>
                    <div className='flex items-center justify-between border-b border-slate-100 px-4 py-3'>
                        <p className='font-semibold'>Notifications{unread ? ` (${unread} new)` : ''}</p>
                        {unread > 0 && (
                            <button type='button' onClick={markAll} className='inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline'>
                                <CheckCheck className='h-4 w-4' aria-hidden /> Mark all read
                            </button>
                        )}
                    </div>
                    <ul className='max-h-[60vh] divide-y divide-slate-100 overflow-y-auto'>
                        {items === null && <li className='px-4 py-6 text-center text-sm text-slate-500'>Loading…</li>}
                        {items?.length === 0 && <li className='px-4 py-6 text-center text-sm text-slate-500'>No notifications yet.</li>}
                        {items?.map(n => {
                            const sos = n.type.startsWith('emergency.raised')
                            return (
                                <li key={n.id}>
                                    <button type='button' onClick={() => openItem(n)} className={`flex w-full gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50 ${sos && !n.read ? 'bg-red-50' : ''}`}>
                                        {sos
                                            ? <Siren className='mt-0.5 h-4 w-4 shrink-0 text-red-600' aria-hidden />
                                            : <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-brand-600'}`} aria-hidden />}
                                        <span className='min-w-0'>
                                            <span className={`block ${n.read ? 'text-slate-700' : 'font-semibold'}`}>{n.title}</span>
                                            <span className='line-clamp-2 block text-slate-500'>{n.body}</span>
                                            <span className='mt-0.5 block text-xs text-slate-400'>{when(n.createdAt)}</span>
                                        </span>
                                    </button>
                                </li>
                            )
                        })}
                    </ul>
                    <Link href='/notifications' onClick={() => setOpen(false)} className='block border-t border-slate-100 bg-slate-50 px-4 py-3 text-center text-sm font-semibold text-brand-700 hover:bg-slate-100'>
                        See all notifications
                    </Link>
                </div>
            )}
        </div>
    )
}
