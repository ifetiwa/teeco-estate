import { ArrowRight, Bell, CheckCircle2, DoorOpen, Megaphone, ShieldCheck, Wallet } from 'lucide-react'
import Link from 'next/link'

import { Logo } from '@/components/Logo'
import { formatNaira } from '@/lib/format'

export const dynamic = 'force-dynamic'

const FEATURES = [
    { icon: Wallet, title: 'Levies without the chasing', body: `Automatic invoices, reminders and receipts. Residents pay online, e.g. a ${formatNaira(2500000)} security levy, straight to the estate's account.` },
    { icon: DoorOpen, title: 'Visitor codes at the gate', body: 'Residents share a 6-digit code or QR. Guards verify it in seconds and residents are told when visitors arrive and leave.' },
    { icon: Megaphone, title: 'Complaints and notices', body: 'Tracked tickets and targeted announcements instead of noisy WhatsApp groups.' },
]

export default function HomePage () {
    return (
        <main>
            <section className='relative overflow-hidden bg-gradient-to-br from-brand-900 via-brand-800 to-brand-600 text-white'>
                <div aria-hidden className='absolute -top-24 -right-24 h-96 w-96 rounded-full bg-accent-500/20 blur-3xl' />
                <div className='relative mx-auto max-w-6xl px-4 pt-6 pb-20'>
                    <header className='flex items-center justify-between'>
                        <Logo inverted />
                        <Link href='/signin' className='btn bg-white text-brand-800 shadow-sm hover:bg-brand-50'>Sign in</Link>
                    </header>
                    <div className='mt-16 max-w-2xl'>
                        <p className='inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-medium ring-1 ring-white/20'>
                            <ShieldCheck className='h-4 w-4 text-accent-400' aria-hidden /> Built for gated estates in Abuja
                        </p>
                        <h1 className='mt-5 text-4xl font-extrabold leading-tight sm:text-5xl'>Run your estate without the chasing</h1>
                        <p className='mt-4 text-lg text-brand-100'>
                            Collect levies online, control the gate with visitor codes, and give residents one place for complaints and notices.
                        </p>
                        <div className='mt-8 flex flex-wrap gap-3'>
                            <Link href='/signin' className='btn bg-accent-500 px-6 py-3 text-base text-brand-900 shadow-sm hover:bg-accent-400'>
                                Get started <ArrowRight className='h-4 w-4' aria-hidden />
                            </Link>
                            <Link href='/signin' className='btn px-6 py-3 text-base text-white ring-1 ring-white/30 hover:bg-white/10'>I have a join code</Link>
                        </div>
                    </div>
                </div>
            </section>

            <section className='mx-auto -mt-10 max-w-6xl px-4'>
                <ul className='grid gap-4 md:grid-cols-3'>
                    {FEATURES.map(f => (
                        <li key={f.title} className='card'>
                            <span className='grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-700'><f.icon className='h-5 w-5' aria-hidden /></span>
                            <h2 className='mt-4 text-lg font-semibold'>{f.title}</h2>
                            <p className='mt-1 text-sm text-slate-600'>{f.body}</p>
                        </li>
                    ))}
                </ul>
            </section>

            <section className='mx-auto mt-14 grid max-w-6xl gap-8 px-4 md:grid-cols-2 md:items-center'>
                <div>
                    <h2 className='text-2xl font-bold'>Every estate&apos;s data stays private</h2>
                    <p className='mt-2 text-slate-600'>Each estate is fully separated at the database level. Guards see the gate, finance sees payments, residents see their own home.</p>
                    <ul className='mt-4 space-y-2 text-sm'>
                        {['Phone sign-in with a one-time code', 'Payments settle directly to the estate', 'Works on any phone, even on a weak network'].map(t => (
                            <li key={t} className='flex items-center gap-2'><CheckCircle2 className='h-5 w-5 text-brand-600' aria-hidden /> {t}</li>
                        ))}
                    </ul>
                </div>
                <div className='card bg-gradient-to-br from-white to-brand-50'>
                    <div className='flex items-center gap-3'>
                        <span className='grid h-10 w-10 place-items-center rounded-full bg-brand-700 text-white'><Bell className='h-5 w-5' aria-hidden /></span>
                        <div>
                            <p className='font-semibold'>Kemi Adebayo has arrived</p>
                            <p className='text-sm text-slate-500'>Checked in at gate 1 · 18:42</p>
                        </div>
                    </div>
                    <div className='mt-4 rounded-xl bg-white p-4 text-center ring-1 ring-slate-200'>
                        <p className='text-sm text-slate-500'>Gate code</p>
                        <p className='font-mono text-4xl font-bold tracking-[0.25em] text-brand-800'>482 915</p>
                    </div>
                </div>
            </section>
        </main>
    )
}
