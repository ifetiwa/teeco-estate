import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import QRCode from 'qrcode'

import { AppHeader } from '@/components/AppHeader'
import { CopyButton } from '@/components/CopyButton'
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
    const qrSvg = await QRCode.toString(passQrPayload(pass), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
    const message = `Hello ${pass.visitorName}, your gate code for ${home.estateName} (${home.unit.label}, ${home.zone.name}) is ${pass.code}. `
        + `Valid ${formatDateTime(pass.validFrom)} to ${formatDateTime(pass.validUntil)} (WAT). Show this code at the gate.`
    const waPhone = pass.visitorPhone ? pass.visitorPhone.replace('+', '') : ''
    const whatsapp = `https://wa.me/${waPhone}?text=${encodeURIComponent(message)}`
    const sms = `sms:${pass.visitorPhone ?? ''}?&body=${encodeURIComponent(message)}`

    return (
        <>
            <AppHeader user={user} />
            <main className='mx-auto max-w-md space-y-6 px-4 py-6'>
                <Link href={`/home/${occupancyId}/passes`} className='text-sm text-brand-700 underline'>← Visitor passes</Link>
                <section className='card text-center'>
                    <p className='text-sm text-slate-600'>Gate pass for</p>
                    <h1 className='text-xl font-semibold'>{pass.visitorName}</h1>
                    <p className='mt-4 font-mono text-5xl font-bold tracking-[0.2em] text-brand-800' aria-label={`Gate code ${pass.code.split('').join(' ')}`}>{pass.code}</p>
                    <div className='mx-auto mt-4 w-56' dangerouslySetInnerHTML={{ __html: qrSvg }} />
                    <p className='mt-4 text-sm text-slate-600'>{formatDateTime(pass.validFrom)} to {formatDateTime(pass.validUntil)}</p>
                    <p className='text-sm text-slate-600'>{pass.usage === 'single' ? 'One entry' : 'Many entries'}{pass.vehiclePlate ? ` · ${pass.vehiclePlate}` : ''}</p>
                    {state !== 'active' && <p className='mt-2 font-medium text-red-700'>{state === 'not_yet_valid' ? 'Not valid yet' : `This pass is ${state}.`}</p>}
                </section>
                {(state === 'active' || state === 'not_yet_valid') && (
                    <section className='grid grid-cols-3 gap-2'>
                        <a href={whatsapp} target='_blank' rel='noopener noreferrer' className='btn-primary'>WhatsApp</a>
                        <a href={sms} className='btn-secondary'>SMS</a>
                        <CopyButton text={message} />
                    </section>
                )}
            </main>
        </>
    )
}
