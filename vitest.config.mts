import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
    resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
    test: {
        environment: 'node',
        globalSetup: ['./tests/globalSetup.ts'],
        setupFiles: ['./tests/setup.ts'],
        include: ['tests/**/*.test.ts'],
        fileParallelism: false,
        testTimeout: 20000,
    },
})
