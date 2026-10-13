import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { type Page, expect } from '@playwright/test'

const OUTBOX = path.resolve('test-results', 'sms-outbox.jsonl')

/** Reads the newest SMS sent to a phone from the dev outbox, waiting for it to arrive. */
export async function latestSms (phone: string, after = 0): Promise<{ body: string, index: number }> {
    for (let i = 0; i < 50; i++) {
        if (existsSync(OUTBOX)) {
            const lines = readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as { to: string, body: string })
            for (let idx = lines.length - 1; idx >= after; idx--) {
                if (lines[idx].to === phone) return { body: lines[idx].body, index: idx + 1 }
            }
        }
        await new Promise(r => setTimeout(r, 200))
    }
    throw new Error(`No SMS to ${phone}`)
}

function outboxSize (): number {
    return existsSync(OUTBOX) ? readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).length : 0
}

/** Signs in through the UI with phone + SMS code. `phone` is local format, e.g. 08030000001. */
export async function signIn (page: Page, localPhone: string): Promise<void> {
    const e164 = `+234${localPhone.slice(1)}`
    const before = outboxSize()
    await page.goto('/signin')
    await page.getByLabel('Phone number').fill(localPhone)
    await page.getByRole('button', { name: 'Send code' }).click()
    await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible()
    const { body } = await latestSms(e164, before)
    await page.getByLabel('6-digit code').fill(body.slice(0, 6))
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL('**/app')
}

export async function signOut (page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Sign out' }).click()
    await page.waitForURL('**/signin')
}
