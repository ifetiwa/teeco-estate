import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

import { Footer } from '@/components/Footer'
import { BRAND } from '@/config/brand'

import './globals.css'

export const metadata: Metadata = {
    title: { default: BRAND.productName, template: `%s · ${BRAND.productName}` },
    description: 'Estate management for gated estates and residents\' associations in Abuja',
    applicationName: BRAND.productName,
}

export const viewport: Viewport = {
    themeColor: BRAND.colors.primary,
    width: 'device-width',
    initialScale: 1,
}

export default function RootLayout ({ children }: { children: ReactNode }) {
    return (
        <html lang='en-NG'>
            <body className='flex min-h-screen flex-col bg-slate-50 text-slate-900 antialiased'>
                <div className='flex-1'>{children}</div>
                <Footer />
            </body>
        </html>
    )
}
