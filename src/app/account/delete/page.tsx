import type { Metadata } from 'next'
import Link from 'next/link'

import { Logo } from '@/components/Logo'
import { BRAND } from '@/config/brand'

export const metadata: Metadata = { title: 'Delete your account' }

/** Public account-deletion instructions; Google Play requires this URL for apps with accounts. */
export default function DeleteAccountPage () {
    const subject = encodeURIComponent(`Delete my ${BRAND.productName} account`)
    const body = encodeURIComponent('Please delete my account.\n\nPhone number I sign in with: \nMy name: \nEstate: ')
    return (
        <main className='mx-auto max-w-3xl px-4 py-8'>
            <Logo />
            <article className='card mt-6 space-y-4 text-sm leading-relaxed text-slate-700 [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-900 [&_li]:ml-5 [&_li]:list-disc'>
                <h1 className='text-2xl font-bold text-slate-900'>Delete your {BRAND.productName} account</h1>
                <p>You can ask us to delete your {BRAND.productName} account and the personal data linked to it at any time.</p>

                <h2>How to ask</h2>
                <ol className='ml-5 list-decimal space-y-1'>
                    <li>Email <a href={`mailto:${BRAND.supportEmail}?subject=${subject}&body=${body}`} className='font-medium text-brand-700 underline'>{BRAND.supportEmail}</a> from any address.</li>
                    <li>Give the phone number you sign in with, your name and your estate.</li>
                    <li>We will text a code to that phone number to confirm it is you, then delete the account within 30 days and email you when it is done.</li>
                </ol>
                <p>
                    <a href={`mailto:${BRAND.supportEmail}?subject=${subject}&body=${body}`} className='btn btn-primary'>Email a deletion request</a>
                </p>

                <h2>What is deleted</h2>
                <ul>
                    <li>Your account: phone number, name, email address and sign-in history.</li>
                    <li>Your place in the estate&apos;s resident list, your household members you added, your phone&apos;s notification tokens and your saved settings.</li>
                    <li>Visitor passes you created, including your visitors&apos; names and phone numbers.</li>
                </ul>

                <h2>What is kept, and for how long</h2>
                <ul>
                    <li>Records of levies you paid are kept by your estate for its accounts, for up to 6 years, with your name removed where the law allows.</li>
                    <li>Emergency alerts and the estate&apos;s audit log are kept for up to 2 years for security, then deleted.</li>
                </ul>
                <p>
                    To delete only some of your data, for example a visitor pass or your email address, email us with what you want removed.
                    See also our <Link href='/privacy' className='font-medium text-brand-700 underline'>privacy policy</Link>.
                </p>
            </article>
        </main>
    )
}
