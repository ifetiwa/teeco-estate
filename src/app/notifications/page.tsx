import { Bell, CheckCheck, Siren } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { AppHeader } from '@/components/AppHeader'
import { EmptyState, PageHeader } from '@/components/ui'
import { actorFromUser } from '@/lib/access'
import { requireUser } from '@/lib/auth/current'
import { formatDateTime } from '@/lib/format'
import { listMyNotifications } from '@/lib/notifications'

import { markAllReadAction } from './actions'

export const metadata: Metadata = { title: 'Notifications' }
export const dynamic = 'force-dynamic'

/** Every recent notification (the bell's "See all"). */
export default async function NotificationsPage () {
    const user = await requireUser()
    const notes = await listMyNotifications(actorFromUser(user), 100)
    const unread = notes.filter(n => !n.readAt).length

    return (
        <>
            <AppHeader user={user} />
            <main className='mx-auto max-w-2xl px-4 py-6'>
                <PageHeader title='Notifications' description={unread ? `${unread} new` : 'You are up to date.'}
                    actions={unread > 0
                        ? <form action={markAllReadAction}><button className='btn-secondary'><CheckCheck className='h-4 w-4' aria-hidden /> Mark all read</button></form>
                        : undefined} />
                {notes.length === 0
                    ? <EmptyState icon={Bell} title='Nothing yet'>Visitor arrivals, payments and estate alerts will show here.</EmptyState>
                    : (
                        <ul className='card divide-y divide-slate-100 p-0'>
                            {notes.map((n) => {
                                const sos = n.type === 'emergency.raised'
                                const body = (
                                    <div className={`flex gap-3 px-4 py-3 ${sos && !n.readAt ? 'bg-red-50' : ''}`}>
                                        {sos
                                            ? <Siren className='mt-0.5 h-4 w-4 shrink-0 text-red-600' aria-hidden />
                                            : <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-brand-600'}`} aria-hidden />}
                                        <div className='min-w-0 text-sm'>
                                            <p className={n.readAt ? 'text-slate-700' : 'font-semibold'}>{n.title}</p>
                                            <p className='text-slate-500'>{n.body}</p>
                                            <p className='mt-0.5 text-xs text-slate-400'>{formatDateTime(n.createdAt)}</p>
                                        </div>
                                    </div>
                                )
                                return <li key={n.id}>{n.link ? <Link href={n.link} className='block hover:bg-slate-50'>{body}</Link> : body}</li>
                            })}
                        </ul>
                    )}
                {notes.length === 100 && <p className='mt-2 text-xs text-slate-500'>Showing the latest 100.</p>}
            </main>
        </>
    )
}
