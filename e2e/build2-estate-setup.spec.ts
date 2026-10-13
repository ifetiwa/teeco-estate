import { expect, test } from '@playwright/test'

import { signIn, signOut } from './helpers'

const ADMIN_PHONE = '08035550100'
const NEW_RESIDENT_PHONE = '08035550999'

test('Build 2: admin sets up 20 units and 40 residents; a self-registered resident reaches the approval queue', async ({ page }) => {
    // Platform admin creates the estate
    await signIn(page, '08030000001')
    await page.getByRole('link', { name: 'Platform' }).click()
    await page.getByLabel('Estate name').fill('Palm Springs Estate')
    await page.getByLabel('District').fill('Gwarinpa')
    await page.getByLabel('Number of gates').fill('2')
    await page.getByLabel('Estate admin / chairman name').fill('Mrs Okafor')
    await page.getByLabel('Estate admin phone').fill(ADMIN_PHONE)
    await page.getByRole('button', { name: 'Create estate' }).click()
    const created = page.getByRole('status')
    await expect(created).toContainText('Palm Springs Estate created. Join code:')
    const joinCode = (await created.textContent())!.match(/Join code: ([A-Z0-9]{6})/)![1]
    await expect(page.getByRole('cell', { name: 'Palm Springs Estate' })).toBeVisible()
    await signOut(page)

    // Estate admin builds the structure
    await signIn(page, ADMIN_PHONE)
    await page.getByRole('link', { name: /Palm Springs Estate/ }).click()
    await expect(page.getByText(joinCode)).toBeVisible()
    await page.getByRole('link', { name: 'Streets & units' }).click()

    for (const [zone, kind, labels, type] of [['Palm Close', 'close', '1-10', 'duplex'], ['Block D', 'block', 'Flat 1-Flat 10', 'flat']]) {
        await page.getByLabel('Name', { exact: true }).fill(zone)
        await page.getByLabel('Type').first().selectOption(kind)
        await page.getByRole('button', { name: 'Add', exact: true }).click()
        await expect(page.getByText(`${zone} added.`)).toBeVisible()
        await page.getByLabel('Street or block').selectOption({ label: zone })
        await page.getByLabel('Numbers').fill(labels)
        await page.getByLabel('Type').nth(1).selectOption(type)
        await page.getByRole('button', { name: 'Add units' }).click()
        await expect(page.getByText('10 units added.')).toBeVisible()
    }

    const unitLinks = await page.locator('a[href*="/units/"]').evaluateAll(els => els.map(e => (e as HTMLAnchorElement).getAttribute('href')!))
    expect(unitLinks).toHaveLength(20)

    // 40 residents: an owner and a household member in every unit
    let n = 0
    for (const href of unitLinks) {
        await page.goto(href)
        for (const relation of ['owner', 'household']) {
            n++
            await page.getByLabel('Full name').fill(`Resident ${n}`)
            await page.getByLabel('Phone', { exact: true }).fill(`0806${String(1000000 + n).slice(-7)}`)
            await page.getByLabel('Relation').selectOption(relation)
            await page.getByRole('button', { name: 'Add resident' }).click()
            await expect(page.getByRole('status')).toContainText(`Resident ${n} added.`)
        }
        await expect(page.locator('li span', { hasText: /^Primary contact$/ })).toHaveCount(1)
    }

    await page.getByRole('link', { name: 'Overview' }).click()
    await expect(page.locator('.card', { hasText: 'Units' }).first()).toContainText('20')
    await expect(page.locator('.card', { hasText: 'Residents' }).first()).toContainText('40')
    await signOut(page)

    // A new resident registers with OTP + join code
    await signIn(page, NEW_RESIDENT_PHONE)
    await page.getByRole('link', { name: 'Join an estate' }).click()
    await page.getByLabel('Estate join code').fill(joinCode.toLowerCase())
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByText('Joining Palm Springs Estate')).toBeVisible()
    await page.getByLabel('Your full name').fill('Musa Danjuma')
    await page.getByLabel('House or flat').selectOption({ label: '7, Palm Close' })
    await page.getByLabel('You are the').selectOption('tenant')
    await page.getByRole('button', { name: 'Send request' }).click()
    await page.waitForURL('**/app')
    await expect(page.getByText('Waiting for approval')).toBeVisible()
    await expect(page.getByText('7, Palm Close, Palm Springs Estate')).toBeVisible()
    await signOut(page)

    // ...and appears in the admin's approval queue
    await signIn(page, ADMIN_PHONE)
    await page.getByRole('link', { name: /Palm Springs Estate/ }).click()
    await expect(page.locator('.card', { hasText: 'Waiting for approval' })).toContainText('1')
    await page.getByRole('link', { name: 'Residents' }).click()
    const queue = page.locator('#approvals')
    await expect(queue).toContainText('Musa Danjuma')
    await expect(queue).toContainText('7, Palm Close · Tenant · 0803 555 0999')
    await queue.getByRole('button', { name: 'Approve' }).click()
    await expect(queue).toContainText('No requests waiting.')
    await expect(page.getByRole('heading', { name: 'Residents (41)' })).toBeVisible()
})
