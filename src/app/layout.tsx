import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import type { ReactNode } from 'react'

import { Footer } from '@/components/Footer'
import { BRAND } from '@/config/brand'

import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })

export const metadata: Metadata = {
    title: { default: BRAND.productName, template: `%s · ${BRAND.productName}` },
    description: 'Estate management for gated estates and residents\' associations in Abuja',
    applicationName: BRAND.productName,
    appleWebApp: { capable: true, title: BRAND.productName, statusBarStyle: 'default' },
}

export const viewport: Viewport = {
    themeColor: BRAND.colors.primary,
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover', // lets the bottom menu sit above the phone's gesture bar
}

export default function RootLayout ({ children }: { children: ReactNode }) {
    return (
        <html lang='en-NG' className={inter.variable}>
            <body className='flex min-h-screen flex-col antialiased'>
                <div className='flex-1'>{children}</div>
                <Footer />
            </body>
        </html>
    )
}
