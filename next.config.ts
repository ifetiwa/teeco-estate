import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
    poweredByHeader: false,
    experimental: {
        // Logo and photo uploads go through server actions
        serverActions: { bodySizeLimit: '6mb' },
    },
}

export default nextConfig
