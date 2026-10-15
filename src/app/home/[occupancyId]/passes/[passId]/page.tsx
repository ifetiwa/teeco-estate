import { CalendarClock, MessageCircle, MessageSquare } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import QRCode from 'qrcode'

import { AppHeader } from '@/components/AppHeader'
import { CopyButton } from '@/components/CopyButton'
import { LogoMark } from '@/components/Logo'
import { PageHeader } from '@/components/ui'
import { actorFromUser } from '@/lib/access'
import { requireUser } from '@/lib/auth/current'
import { NotFoundError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { getMyHome } from '@/lib/residents'
import { getPassForResident, passQrPayload, passState } from '@/lib/visitors'

export const metadata: Metadata = { title: 'Visitor pass' }

export default async function PassPage ({ params }: { params: Promise<{ occupancyId: string, passId: string }> }) {
    const { occupancyId, passId } = await params
    const user = await requireUser()
    const actor = actorFromUser(user)
    let home, pass
    try {
        home = await getMyHome(actor, occupancyId)
        pass = await getPassForResident(actor, home.occupancy.estateId, passId)
    } catch (e) {
        if (e instanceof NotFoundError || (e as { code?: string }).code === '22P02') notFound()
        throw e
    }
    const state = passState(pass)
    const qrSvg = await QRCode.toString(passQrPayload(pass), { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0a3622', light: '#ffffff' } })
    const message = `Hello ${pass.visitorName}, your gate code for ${home.estateName} (${home.unit.label}, ${home.zone.name}) is ${pass.code}. `
        + `Valid ${formatDateTime(pass.validFrom)} to ${formatDateTime(pass.validUntil)} (WAT). Show this code at the gate.`
    const waPhone = pass.visitorPhone ? pass.visitorPhone.replace('+', '') : ''
    const whatsapp = `https://wa.me/${waPhone}?text=${encodeURIComponent(message)}`
    const sms = `sms:${pass.visitorPhone ?? ''}?&body=${encodeURIComponent(message)}`
    const usable = state === 'active' || state === 'not_yet_valid'

    return (
        <>
            <AppHeader user={user} />
            <main className='mx-auto max-w-md space-y-6 px-4 py-6'>
                <PageHeader back={{ href: `/home/${occupancyId}/passes`, label: 'Visitor passes' }} title='Gate pass' />
                <section className='overflow-hidden rounded-3xl bg-white shadow-(--shadow-raised) ring-1 ring-slate-200'>
                    <div className='flex items-center gap-3 bg-gradient-to-r from-brand-800 to-brand-600 px-5 py-4 text-white'>
                        <LogoMark className='h-9 w-9' />
                        <div className='min-w-0'>
                            <p className='truncate font-semibold'>{home.estateName}</p>
                            <p className='truncate text-sm text-brand-100'>To {home.unit.label}, {home.zone.name}</p>
                        </div>
                    </div>
                    <div className='px-5 py-6 text-center'>
                        <p className='text-sm text-slate-500'>Gate pass for</p>
                        <h2 className='text-2xl font-bold'>{pass.visitorName}</h2>
                        <p className='mt-4 font-mono text-5xl font-extrabold tracking-[0.2em] text-brand-800' aria-label={`Gate code ${pass.code.split('').join(' ')}`}>{pass.code}</p>
                        <div className={`mx-auto mt-5 w-52 rounded-2xl p-2 ring-1 ring-slate-200 ${usable ? '' : 'opacity-30'}`} dangerouslySetInnerHTML={{ __html: qrSvg }} />
                        <p className='mt-5 inline-flex items-center gap-1.5 text-sm text-slate-600'><CalendarClock className='h-4 w-4' aria-hidden /> {formatDateTime(pass.validFrom)} to {formatDateTime(pass.validUntil)}</p>
                        <p className='text-sm text-slate-600'>{pass.usage === 'single' ? 'One entry' : 'Many entries'}{pass.vehiclePlate ? ` · ${pass.vehiclePlate}` : ''}</p>
                        {!usable && <p className='mt-3 rounded-lg bg-red-50 px-3 py-2 font-semibold text-red-700'>This pass is {state.replace(/_/g, ' ')}.</p>}
                        {state === 'not_yet_valid' && <p className='mt-3 rounded-lg bg-sky-50 px-3 py-2 font-medium text-sky-700'>Not valid yet</p>}
                    </div>
                </section>
                {usable && (
                    <section className='grid grid-cols-3 gap-2'>
                        <a href={whatsapp} target='_blank' rel='noopener noreferrer' className='btn bg-[#25D366] text-white shadow-sm hover:brightness-95'><MessageCircle className='h-4 w-4' aria-hidden />WhatsApp</a>
                        <a href={sms} className='btn-secondary'><MessageSquare className='h-4 w-4' aria-hidden />SMS</a>
                        <CopyButton text={message} />
                    </section>
                )}
            </main>
        </>
    )
}
