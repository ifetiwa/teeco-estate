import { execFileSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import { signIn } from './helpers'

/** Seeds two estates through the app's domain API (as the restricted app role) in a tsx subprocess. */
function seed (): { estateId: string, otherCode: string, expiredCode: string } {
    const out = execFileSync(process.execPath, [require.resolve('tsx/cli'), 'e2e/seed-build4.ts'], {
        env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL },
        encoding: 'utf8',
    })
    return JSON.parse(out.trim().split('\n').pop()!)
}

test('Build 4: create pass, check in at gate, resident notified, check out; expired, used and wrong-estate codes rejected', async ({ browser }) => {
    const { estateId, otherCode, expiredCode } = seed()

    const resident = await (await browser.newContext()).newPage()
    const guard = await (await browser.newContext()).newPage()
    await signIn(resident, '08035550301')
    await signIn(guard, '08035550302')

    // Resident creates a pass
    await resident.getByRole('link', { name: /1, Palm Close/ }).click()
    await resident.getByRole('link', { name: 'Visitor passes' }).click()
    await resident.getByLabel('Visitor name').fill('Kemi Adebayo')
    await resident.getByLabel('Purpose (optional)').fill('Birthday')
    await resident.getByRole('button', { name: 'Create pass' }).click()
    await expect(resident.getByRole('heading', { name: 'Kemi Adebayo' })).toBeVisible()
    const code = (await resident.getByLabel(/^Gate code/).textContent())!.trim()
    expect(code).toMatch(/^\d{6}$/)
    await expect(resident.locator('svg').first()).toBeVisible() // QR image
    await expect(resident.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', new RegExp(`wa\\.me/\\?text=.*${code}`))

    // Guard opens the gate screen (guards land there from the home screen)
    await guard.getByRole('link', { name: /Visitors Villa/ }).click()
    await guard.waitForURL(`**/gate/${estateId}`)
    await guard.getByRole('button', { name: '2', exact: true }).click() // gate 2
    await guard.getByLabel('Visitor code').fill(code)
    await guard.getByRole('button', { name: 'Check code' }).click()
    await expect(guard.getByText('Valid pass')).toBeVisible()
    await expect(guard.getByText('To: 1, Palm Close (Ada Obi)')).toBeVisible()
    await guard.getByRole('button', { name: 'Allow in' }).click()
    await expect(guard.getByText('Kemi Adebayo checked in. The resident has been told.')).toBeVisible()
    const inside = guard.locator('section', { hasText: 'Inside now (1)' })
    await expect(inside).toContainText('Kemi Adebayo')

    // Resident is notified of the arrival
    await resident.goto('/app')
    await expect(resident.getByText('Kemi Adebayo has arrived')).toBeVisible()
    await expect(resident.getByText(/Checked in at gate 2/)).toBeVisible()

    // Same code again: used
    await guard.getByRole('button', { name: 'Next visitor' }).click()
    await guard.getByLabel('Visitor code').fill(code)
    await guard.getByRole('button', { name: 'Check code' }).click()
    await expect(guard.getByText('Do not admit')).toBeVisible()
    await expect(guard.getByText('This pass has already been used.')).toBeVisible()
    await guard.getByRole('button', { name: 'OK' }).click()

    // Expired code
    await guard.getByLabel('Visitor code').fill(expiredCode)
    await guard.getByRole('button', { name: 'Check code' }).click()
    await expect(guard.getByText(/This pass expired at/)).toBeVisible()
    await guard.getByRole('button', { name: 'OK' }).click()

    // Code from another estate
    await guard.getByLabel('Visitor code').fill(otherCode)
    await guard.getByRole('button', { name: 'Check code' }).click()
    await expect(guard.getByText('This code is for a different estate. It cannot be used here.')).toBeVisible()
    await guard.getByRole('button', { name: 'OK' }).click()

    // Check out, resident told
    await inside.getByRole('button', { name: 'Check out' }).click()
    await expect(guard.locator('section', { hasText: 'Inside now (0)' })).toBeVisible()
    await resident.goto('/app')
    await expect(resident.getByText('Kemi Adebayo has left')).toBeVisible()

    // Walk-in: guard asks, resident approves on their phone, guard admits
    await guard.getByRole('button', { name: 'Visitor without a code' }).click()
    await guard.getByLabel('Going to house').selectOption({ label: '1, Palm Close' })
    await guard.getByLabel('Visitor name').fill('Delivery Man')
    await guard.getByLabel('Purpose').fill('Parcel')
    await guard.getByRole('button', { name: 'Ask the resident' }).click()
    await expect(guard.locator('section', { hasText: 'Waiting for resident' })).toContainText('Delivery Man')
    await resident.goto('/app')
    const atGate = resident.locator('section', { hasText: 'Visitor at the gate' })
    await expect(atGate).toContainText('Delivery Man is at gate 2')
    await atGate.getByRole('button', { name: 'Let them in' }).click()
    await expect(atGate).toHaveCount(0)
    await guard.reload()
    const approved = guard.locator('section', { hasText: 'Approved by resident' })
    await expect(approved).toContainText('Delivery Man')
    await approved.getByRole('button', { name: 'Check in' }).click()
    await expect(guard.locator('section', { hasText: 'Inside now (1)' })).toContainText('Delivery Man')
})
