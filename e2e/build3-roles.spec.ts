import { expect, test } from '@playwright/test'

import { signIn, signOut } from './helpers'

const ADMIN = '08035550200'
const GUARD = '08035550201'

test('Build 3: guard is limited to the gate area; platform support access is reasoned, read-only and logged', async ({ page }) => {
    await signIn(page, '08030000001')
    await page.getByRole('link', { name: 'Platform', exact: true }).click()
    await page.getByLabel('Estate name').fill('Guarded Gardens')
    await page.getByLabel('Estate admin / chairman name').fill('Mr Adamu')
    await page.getByLabel('Estate admin phone').fill(ADMIN)
    await page.getByRole('button', { name: 'Create estate' }).click()
    await expect(page.getByRole('status')).toContainText('Guarded Gardens created.')
    await signOut(page)

    // Estate admin adds a guard
    await signIn(page, ADMIN)
    await page.getByRole('link', { name: /Guarded Gardens/ }).click()
    await page.waitForURL(/\/estate\/[0-9a-f-]{36}$/)
    const estateUrl = page.url()
    await page.getByRole('link', { name: 'Staff', exact: true }).click()
    await page.getByLabel('Name', { exact: true }).fill('Sule Guard')
    await page.getByLabel('Phone', { exact: true }).fill(GUARD)
    await page.getByLabel('Role').selectOption('guard')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByText('Sule Guard')).toBeVisible()
    await signOut(page)

    // Guard: no Residents/Staff/Settings, and direct URLs are 404
    await signIn(page, GUARD)
    await page.getByRole('link', { name: /Guarded Gardens/ }).click()
    await page.waitForURL(/\/gate\//) // guards land on the gate screen
    await page.goto(estateUrl)
    await expect(page.getByRole('link', { name: 'Streets & units', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Residents', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Staff', exact: true })).toHaveCount(0)
    for (const path of ['/residents', '/staff', '/settings']) {
        const res = await page.goto(estateUrl + path)
        expect(res?.status()).toBe(404)
    }
    await page.goto('/app')
    await signOut(page)

    // Platform admin: 404 without a grant, then opens support access with a reason
    await signIn(page, '08030000001')
    expect((await page.goto(estateUrl))?.status()).toBe(404)
    await page.goto('/platform')
    const estateRow = page.getByRole('row', { name: /Guarded Gardens/ })
    await estateRow.getByRole('textbox').fill('Ticket 42: chairman cannot see units')
    await estateRow.getByRole('button', { name: 'Open' }).click()
    await expect(page.getByText('Teeco support access: read-only.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Staff', exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: 'Streets & units', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Add a street or block' })).toHaveCount(0)
    await signOut(page)

    // The estate admin can see who accessed the estate and why
    await signIn(page, ADMIN)
    await page.goto(estateUrl + '/settings')
    await expect(page.getByText('Ticket 42: chairman cannot see units')).toBeVisible()
    await expect(page.getByText('active now')).toBeVisible()
})
