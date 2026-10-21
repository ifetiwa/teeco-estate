import type { MetadataRoute } from 'next'

import { BRAND } from '@/config/brand'

/** Lets phones install the web app from the browser ("Add to Home Screen"), e.g. iPhones, which can't use the APK. */
export default function manifest (): MetadataRoute.Manifest {
    return {
        name: BRAND.productName,
        short_name: BRAND.productName,
        description: 'Visitor passes, levies, emergencies and notices for your estate',
        start_url: '/app',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: BRAND.colors.primary,
        theme_color: BRAND.colors.primary,
        icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
    }
}
