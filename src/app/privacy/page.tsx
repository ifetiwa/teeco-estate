import type { Metadata } from 'next'
import Link from 'next/link'

import { Logo } from '@/components/Logo'
import { BRAND } from '@/config/brand'

export const metadata: Metadata = { title: 'Privacy policy' }

const UPDATED = '23 October 2026'

/** Public privacy policy; its URL is given in the Google Play listing and the app's data safety form. */
export default function PrivacyPage () {
    return (
        <main className='mx-auto max-w-3xl px-4 py-8'>
            <Logo />
            <article className='card mt-6 space-y-4 text-sm leading-relaxed text-slate-700 [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-900 [&_li]:ml-5 [&_li]:list-disc'>
                <h1 className='text-2xl font-bold text-slate-900'>Privacy policy</h1>
                <p className='text-slate-500'>Last updated {UPDATED}</p>
                <p>
                    {BRAND.productName} is an estate management service run by {BRAND.legalName} ({BRAND.rcNumber}), Abuja, Nigeria
                    (&quot;we&quot;). It is used by estates and residents&apos; associations, their staff and their residents, on the web and
                    in the {BRAND.productName} Android app. This policy explains what we collect, why, and the choices you have. We process
                    personal data in line with the Nigeria Data Protection Act 2023.
                </p>

                <h2>What we collect</h2>
                <ul>
                    <li><strong>Account details:</strong> your phone number (used to sign in with a one-time code), your name and, if you add it, your email address.</li>
                    <li><strong>Your home in the estate:</strong> the estate, zone and unit you live in or work at, your role (for example resident, guard or estate admin) and your household members as added by you or your estate.</li>
                    <li><strong>Visitor passes:</strong> the names and phone numbers of visitors you invite, the pass codes, and when visitors arrive and leave.</li>
                    <li><strong>Payments:</strong> records of estate levies and dues, amounts and receipts. We do not store card numbers.</li>
                    <li><strong>Emergencies:</strong> when you press the emergency button, the time, your home address in the estate and, if you allow it, your phone&apos;s precise location at that moment. Location is never collected in the background.</li>
                    <li><strong>Camera:</strong> guards use the camera to scan visitors&apos; QR codes. Images are processed on the phone and are not uploaded or stored.</li>
                    <li><strong>Notifications and security:</strong> a push notification token for your phone, and records of sign-ins and of actions taken by staff and support (an audit log). The optional fingerprint lock is handled entirely by your phone; we never receive your fingerprint.</li>
                </ul>

                <h2>How we use it</h2>
                <ul>
                    <li>To sign you in and keep your account secure.</li>
                    <li>To run the estate features you use: visitor passes, levies and payment records, notifications and emergency alerts.</li>
                    <li>To send you sign-in codes, alerts and reminders by SMS, email or push notification.</li>
                    <li>To prevent abuse and investigate problems.</li>
                </ul>
                <p>We do not sell personal data and we do not use it for advertising. The app contains no ads.</p>

                <h2>Who can see it</h2>
                <ul>
                    <li><strong>Your estate:</strong> estate admins and finance officers see residents and payments for their own estate. Guards see visitor passes and gate activity. In an emergency, guards and estate admins see your address and location so they can respond. Each estate&apos;s data is kept separate from every other estate.</li>
                    <li><strong>Our support staff:</strong> only after recording a reason, read-only and for a limited time, and every view is shown to the estate admin.</li>
                    <li><strong>Service providers</strong> who process data for us under contract: hosting and database (Vercel, Neon, servers in the European Union), push notifications (Google Firebase), SMS delivery (Termii) and email delivery.</li>
                    <li>Authorities, when the law requires it.</li>
                </ul>

                <h2>How long we keep it</h2>
                <p>
                    We keep your data while your account is active. Payment records are kept for as long as the estate needs them for its
                    accounts and as the law requires (usually up to 6 years). Expired sign-in codes are deleted automatically.
                </p>

                <h2>Your choices and rights</h2>
                <ul>
                    <li>You can see and correct your details in the app, and turn off location, camera and notification permissions in your phone&apos;s settings.</li>
                    <li>You can ask for a copy of your data, its correction or its deletion. See <Link href='/account/delete' className='font-medium text-brand-700 underline'>how to delete your account</Link>.</li>
                    <li>You can complain to the Nigeria Data Protection Commission (ndpc.gov.ng).</li>
                </ul>

                <h2>Security</h2>
                <p>Data is encrypted in transit (HTTPS) and at rest by our hosting providers. Access inside each estate is limited by role.</p>

                <h2>Children</h2>
                <p>The service is for adults managing or living in an estate. It is not directed at children under 13.</p>

                <h2>Contact</h2>
                <p>
                    {BRAND.legalName}, Abuja, Nigeria. Email <a href={`mailto:${BRAND.supportEmail}`} className='font-medium text-brand-700 underline'>{BRAND.supportEmail}</a>.
                    We will post any changes to this policy on this page.
                </p>
            </article>
        </main>
    )
}
