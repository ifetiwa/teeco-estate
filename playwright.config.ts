import 'dotenv/config'

import path from 'node:path'

import { defineConfig, devices } from '@playwright/test'

const PORT = 3100
export const SMS_OUTBOX = path.resolve('test-results', 'sms-outbox.jsonl')

export default defineConfig({
    testDir: './e2e',
    globalSetup: './e2e/global-setup.ts',
    fullyParallel: false,
    workers: 1,
    timeout: 180_000,
    expect: { timeout: 10_000 },
    reporter: [['list']],
    use: {
        baseURL: `http://localhost:${PORT}`,
        trace: 'retain-on-failure',
        ...devices['Pixel 7'],
    },
    webServer: {
        command: `npx next start -p ${PORT}`,
        url: `http://localhost:${PORT}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
            DATABASE_URL: process.env.E2E_DATABASE_URL!,
            DEV_SMS_OUTBOX: SMS_OUTBOX,
            SESSION_SECRET: process.env.SESSION_SECRET!,
            UPLOAD_DIR: path.resolve('test-results', 'uploads'),
        },
    },
})
