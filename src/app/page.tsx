import Link from 'next/link'

import { Logo } from '@/components/Logo'
import { formatNaira } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default function HomePage () {
    return (
        <main className='mx-auto max-w-3xl px-4 py-8'>
            <header className='flex items-center justify-between'>
                <Logo />
                <Link href='/signin' className='btn-primary'>Sign in</Link>
            </header>
            <section className='mt-12'>
                <h1 className='text-3xl font-bold text-brand-800'>Run your estate without the chasing</h1>
                <p className='mt-3 text-lg text-slate-600'>
                    Collect levies online, control the gate with visitor codes, and give residents one place for complaints and notices.
                </p>
                <ul className='mt-8 grid gap-4 sm:grid-cols-3'>
                    <li className='card'>
                        <h2 className='font-semibold'>Levies</h2>
                        <p className='mt-1 text-sm text-slate-600'>Automatic invoices, e.g. a {formatNaira(2500000)} security levy, with reminders and receipts.</p>
                    </li>
                    <li className='card'>
                        <h2 className='font-semibold'>Visitor passes</h2>
                        <p className='mt-1 text-sm text-slate-600'>Residents share a code; guards verify it in seconds.</p>
                    </li>
                    <li className='card'>
                        <h2 className='font-semibold'>Complaints & notices</h2>
                        <p className='mt-1 text-sm text-slate-600'>Tracked tickets and targeted announcements instead of noisy WhatsApp groups.</p>
                    </li>
                </ul>
            </section>
        </main>
    )
}
