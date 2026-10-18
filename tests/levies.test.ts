import { beforeEach, describe, expect, it } from 'vitest'

import {
    estateCollectionTotals, listPayments, listUnitPayments, paymentStatus, paymentsByUnit, recordPayment, sendPaymentReminders, updateChargeSettings,
    voidPayment,
} from '@/lib/levies'
import { listMyNotifications } from '@/lib/notifications'
import { amountTowards, parseMonth, periodKeyFor, periodLabel, periodRange, rangeLabel, recentPeriods } from '@/lib/periods'
import { addResident } from '@/lib/residents'
import { addStaff } from '@/lib/staff'

import { actorFor, createTestEstate, nextPhone, resetDb, useConsoleSms } from './helpers'

beforeEach(resetDb)

const OCT = new Date('2026-10-18T10:00:00Z')

/** Houses 1-4: residents at 1, 2 and 3; house 4 is empty. */
async function setup (name = 'Sunshine Estate') {
    const t = await createTestEstate({ name, houses: '1-4' })
    const residentPhone = nextPhone()
    const occ = await addResident(t.admin, t.estate.id, { unitId: t.units[0].id, name: 'Ada Obi', phone: residentPhone, relation: 'owner' })
    const resident = actorFor(occ.userId!)
    const house2Phone = nextPhone()
    await addResident(t.admin, t.estate.id, { unitId: t.units[1].id, name: 'Musa Bello', phone: house2Phone, relation: 'owner' })
    const house3Phone = nextPhone()
    const house3Tenant = nextPhone()
    await addResident(t.admin, t.estate.id, { unitId: t.units[2].id, name: 'Kemi Ade', phone: house3Phone, relation: 'owner' })
    await addResident(t.admin, t.estate.id, { unitId: t.units[2].id, name: 'Tunde Ade', phone: house3Tenant, relation: 'household' })
    const fin = actorFor((await addStaff(t.admin, t.estate.id, { name: 'Grace Finance', phone: nextPhone(), role: 'finance_officer' })).userId)
    const guard = actorFor((await addStaff(t.admin, t.estate.id, { name: 'Sule Guard', phone: nextPhone(), role: 'guard' })).userId)
    const [h1, h2, h3, h4] = t.units.map(u => u.id)
    return { ...t, resident, residentPhone, house2Phone, house3Phone, house3Tenant, fin, guard, h1, h2, h3, h4 }
}

async function setCharges (s: Awaited<ReturnType<typeof setup>>, opts: { share?: boolean } = {}) {
    await updateChargeSettings(s.fin, s.estate.id, {
        securityAmount: '15,000', securityFrequency: 'monthly', serviceAmount: '120,000', serviceFrequency: 'yearly',
        showEstateTotalsToResidents: opts.share ? 'on' : '',
    })
}

describe('billing periods', () => {
    it('labels, ranges and spreads payments over months', () => {
        const oct = parseMonth('2026-10')!
        expect(rangeLabel(oct, oct)).toBe('October 2026')
        expect(rangeLabel(parseMonth('2026-01')!, parseMonth('2026-12')!)).toBe('2026')
        expect(rangeLabel(parseMonth('2026-10')!, parseMonth('2026-12')!)).toBe('Q4 2026')
        expect(rangeLabel(parseMonth('2026-11')!, parseMonth('2027-02')!)).toBe('Nov 2026 to Feb 2027')
        expect(periodKeyFor('quarterly', oct)).toBe('2026-Q4')
        expect(periodRange('yearly', '2026')).toEqual({ from: parseMonth('2026-01'), to: parseMonth('2026-12') })
        expect(periodLabel('quarterly', '2026-Q1')).toBe('Q1 2026')
        expect(periodRange('monthly', '2026-13')).toBeNull()
        // ₦120,000 for the year counts ₦30,000 towards a quarter and ₦10,000 towards a month
        const year = { amountKobo: 12_000_000, from: parseMonth('2026-01')!, to: parseMonth('2026-12')! }
        expect(amountTowards(year, parseMonth('2026-10')!, parseMonth('2026-12')!)).toBe(3_000_000)
        expect(amountTowards(year, oct, oct)).toBe(1_000_000)
        expect(amountTowards(year, parseMonth('2027-01')!, parseMonth('2027-01')!)).toBe(0)
        expect(recentPeriods('monthly', OCT).slice(0, 3).map(p => p.key)).toEqual(['2026-11', '2026-10', '2026-09'])
        expect(recentPeriods('yearly', OCT).map(p => p.key)).toEqual(['2027', '2026', '2025', '2024', '2023', '2022'])
    })
})

describe('levy and service charge records', () => {
    it('records payments, totals them by charge and by house, and tells the residents', async () => {
        const s = await setup()
        await recordPayment(s.fin, s.estate.id, { unitId: s.h1, kind: 'security_levy', amount: '15,000', coversFrom: '2026-10', paidOn: '2026-10-02', method: 'bank_transfer', reference: 'GTB-123' }, OCT)
        await recordPayment(s.fin, s.estate.id, { unitId: s.h1, kind: 'service_charge', amount: '₦50,000.50', coversFrom: '2026-01', coversTo: '2026-12', paidOn: '2026-09-15', method: 'cash' }, OCT)
        await recordPayment(s.admin, s.estate.id, { unitId: s.h2, kind: 'security_levy', amount: '15000', coversFrom: '2026-10', paidOn: '2026-10-05' }, OCT)

        const all = await listPayments(s.fin, s.estate.id)
        expect(all.rows).toHaveLength(3)
        expect(all.rows.map(r => r.payment.period).sort()).toEqual(['2026', 'October 2026', 'October 2026'])
        expect(all.byKind.security_levy).toEqual({ totalKobo: 3_000_000, count: 2 })
        expect(all.byKind.service_charge).toEqual({ totalKobo: 5_000_050, count: 1 })
        expect(all.totalKobo).toBe(8_000_050)
        expect((await listPayments(s.fin, s.estate.id, { from: '2026-10-01', to: '2026-10-31' })).rows).toHaveLength(2)

        const perHouse = await paymentsByUnit(s.fin, s.estate.id)
        expect(perHouse).toHaveLength(4)
        expect(perHouse.find(r => r.unitId === s.h1)).toMatchObject({ securityKobo: 1_500_000, serviceKobo: 5_000_050, lastPaidOn: '2026-10-02' })

        const notes = await listMyNotifications(s.resident)
        expect(notes.some(n => n.body.includes('15,000') && n.body.includes('security levy for October 2026'))).toBe(true)
    })

    it('voids a payment with a reason: excluded from totals, kept in history', async () => {
        const s = await setup()
        const p = await recordPayment(s.fin, s.estate.id, { unitId: s.h1, kind: 'security_levy', amount: '150000', coversFrom: '2026-10', paidOn: '2026-10-02' }, OCT)
        await expect(voidPayment(s.fin, s.estate.id, p.id, 'no')).rejects.toThrow(/reason/)
        await voidPayment(s.fin, s.estate.id, p.id, 'Typed an extra zero')
        await expect(voidPayment(s.fin, s.estate.id, p.id, 'Typed an extra zero')).rejects.toThrow(/already voided/)
        expect((await listPayments(s.fin, s.estate.id)).rows).toHaveLength(0)
        expect((await listPayments(s.fin, s.estate.id, { includeVoided: true })).rows[0].payment.voidReason).toBe('Typed an extra zero')
        expect((await listUnitPayments(s.resident, s.estate.id, s.h1, OCT)).securityKobo).toBe(0)
    })

    it('rejects bad amounts, months and future dates', async () => {
        const s = await setup()
        const base = { unitId: s.h1, kind: 'security_levy' as const, coversFrom: '2026-10', paidOn: '2026-10-02' }
        await expect(recordPayment(s.fin, s.estate.id, { ...base, amount: '0' }, OCT)).rejects.toThrow()
        await expect(recordPayment(s.fin, s.estate.id, { ...base, amount: 'abc' }, OCT)).rejects.toThrow()
        await expect(recordPayment(s.fin, s.estate.id, { ...base, amount: '500,000,000' }, OCT)).rejects.toThrow()
        await expect(recordPayment(s.fin, s.estate.id, { ...base, amount: '1000', paidOn: '2026-10-20' }, OCT)).rejects.toThrow(/future/)
        await expect(recordPayment(s.fin, s.estate.id, { ...base, amount: '1000', coversTo: '2026-09' }, OCT)).rejects.toThrow(/on or after/)
        await expect(recordPayment(s.fin, s.estate.id, { ...base, amount: '1000', coversTo: '2030-01' }, OCT)).rejects.toThrow(/at most/)
        await expect(recordPayment(s.fin, s.estate.id, { ...base, amount: '1000', coversFrom: 'October' }, OCT)).rejects.toThrow()
    })

    it('only finance staff record; guards and other houses cannot see records', async () => {
        const s = await setup()
        const other = await setup('Other Estate')
        const input = { unitId: s.h1, kind: 'security_levy' as const, amount: '1000', coversFrom: '2026-10', paidOn: '2026-10-02' }
        await expect(recordPayment(s.guard, s.estate.id, input, OCT)).rejects.toThrow(/permission/)
        await expect(recordPayment(s.resident, s.estate.id, input, OCT)).rejects.toThrow(/permission/)
        await expect(listPayments(s.guard, s.estate.id)).rejects.toThrow(/permission/)
        await expect(paymentStatus(s.guard, s.estate.id, 'security_levy')).rejects.toThrow(/permission/)
        await expect(listUnitPayments(s.resident, s.estate.id, s.h2)).rejects.toThrow(/permission/)
        await expect(recordPayment(other.fin, s.estate.id, input, OCT)).rejects.toThrow(/permission/)
        await expect(recordPayment(other.fin, other.estate.id, input, OCT)).rejects.toThrow(/not found/)
        await expect(updateChargeSettings(s.guard, s.estate.id, { securityAmount: '1', securityFrequency: 'monthly', serviceFrequency: 'yearly' })).rejects.toThrow(/permission/)
    })
})

describe('who has paid', () => {
    it('shows each house as paid, part paid, not paid or empty for a period', async () => {
        const s = await setup()
        await setCharges(s)
        await recordPayment(s.fin, s.estate.id, { unitId: s.h1, kind: 'security_levy', amount: '15,000', coversFrom: '2026-10', paidOn: '2026-10-02' }, OCT)
        await recordPayment(s.fin, s.estate.id, { unitId: s.h2, kind: 'security_levy', amount: '5,000', coversFrom: '2026-10', paidOn: '2026-10-03' }, OCT)
        // House 3 paid three months in advance last month
        await recordPayment(s.fin, s.estate.id, { unitId: s.h3, kind: 'security_levy', amount: '45,000', coversFrom: '2026-09', coversTo: '2026-11', paidOn: '2026-09-01' }, OCT)

        const oct = await paymentStatus(s.fin, s.estate.id, 'security_levy', undefined, OCT)
        expect(oct.period).toMatchObject({ key: '2026-10', label: 'October 2026' })
        const byUnit = Object.fromEntries(oct.rows.map(r => [r.unitId, r]))
        expect(byUnit[s.h1]).toMatchObject({ state: 'paid', paidKobo: 1_500_000, outstandingKobo: 0 })
        expect(byUnit[s.h2]).toMatchObject({ state: 'part_paid', paidKobo: 500_000, outstandingKobo: 1_000_000 })
        expect(byUnit[s.h3]).toMatchObject({ state: 'paid', paidKobo: 1_500_000 })
        expect(byUnit[s.h4]).toMatchObject({ state: 'vacant', residents: [] })
        expect(byUnit[s.h3].residents.map(r => r.name)).toEqual(['Kemi Ade', 'Tunde Ade'])
        expect(oct.summary).toMatchObject({ paid: 2, partPaid: 1, unpaid: 0, vacant: 1, expectedKobo: 4_500_000, collectedKobo: 3_500_000 })

        const dec = await paymentStatus(s.fin, s.estate.id, 'security_levy', '2026-12', OCT)
        expect(dec.summary).toMatchObject({ paid: 0, unpaid: 3 })
        // Yearly service charge: half paid counts as part paid
        await recordPayment(s.fin, s.estate.id, { unitId: s.h1, kind: 'service_charge', amount: '60,000', coversFrom: '2026-01', coversTo: '2026-12', paidOn: '2026-03-01' }, OCT)
        const service = await paymentStatus(s.fin, s.estate.id, 'service_charge', '2026', OCT)
        expect(service.rows.find(r => r.unitId === s.h1)).toMatchObject({ state: 'part_paid', outstandingKobo: 6_000_000 })
    })

    it('without a set amount, any payment counts as paid', async () => {
        const s = await setup()
        await recordPayment(s.fin, s.estate.id, { unitId: s.h1, kind: 'security_levy', amount: '100', coversFrom: '2026-10', paidOn: '2026-10-02' }, OCT)
        const st = await paymentStatus(s.fin, s.estate.id, 'security_levy', '2026-10', OCT)
        expect(st.expectedKobo).toBe(0)
        expect(st.summary).toMatchObject({ paid: 1, unpaid: 2 })
    })

    it('reminds unpaid houses by SMS and in-app, skipping paid houses and recent reminders', async () => {
        const s = await setup()
        await setCharges(s)
        await recordPayment(s.fin, s.estate.id, { unitId: s.h1, kind: 'security_levy', amount: '15,000', coversFrom: '2026-10', paidOn: '2026-10-02' }, OCT)
        await recordPayment(s.fin, s.estate.id, { unitId: s.h2, kind: 'security_levy', amount: '5,000', coversFrom: '2026-10', paidOn: '2026-10-03' }, OCT)
        const sms = useConsoleSms()

        const res = await sendPaymentReminders(s.fin, s.estate.id, { kind: 'security_levy', periodKey: '2026-10', message: 'Pay to Zenith 1234567890.' }, OCT)
        expect(res).toEqual({ reminded: 2, skippedPaid: 2, skippedRecent: 0, recipients: 3 })
        expect(sms.lastTo(s.residentPhone)).toBeUndefined()
        expect(sms.lastTo(s.house2Phone)!.body).toContain('₦10,000.00 outstanding')
        expect(sms.lastTo(s.house2Phone)!.body).toContain('Pay to Zenith 1234567890.')
        expect(sms.lastTo(s.house3Tenant)!.body).toContain('security levy for October 2026')

        // Again straight away: nobody is texted twice
        expect(await sendPaymentReminders(s.fin, s.estate.id, { kind: 'security_levy', periodKey: '2026-10' }, new Date(OCT.getTime() + 3_600_000)))
            .toMatchObject({ reminded: 0, skippedRecent: 2 })
        // A day later, one chosen house
        const next = await sendPaymentReminders(s.fin, s.estate.id, { kind: 'security_levy', periodKey: '2026-10', unitIds: [s.h2] }, new Date(OCT.getTime() + 24 * 3_600_000))
        expect(next).toMatchObject({ reminded: 1, recipients: 1 })

        const st = await paymentStatus(s.fin, s.estate.id, 'security_levy', '2026-10', OCT)
        expect(st.rows.find(r => r.unitId === s.h2)).toMatchObject({ reminderCount: 2 })
        expect(st.rows.find(r => r.unitId === s.h1)).toMatchObject({ reminderCount: 0, lastRemindedAt: null })
        await expect(sendPaymentReminders(s.guard, s.estate.id, { kind: 'security_levy', periodKey: '2026-10' })).rejects.toThrow(/permission/)
        await expect(sendPaymentReminders(s.fin, s.estate.id, { kind: 'security_levy', periodKey: '2026' })).rejects.toThrow(/valid period/)
    })
})

describe('totals by month and year', () => {
    async function history (s: Awaited<ReturnType<typeof setup>>) {
        await recordPayment(s.fin, s.estate.id, { unitId: s.h1, kind: 'security_levy', amount: '15,000', coversFrom: '2026-09', paidOn: '2026-09-02' }, OCT)
        await recordPayment(s.fin, s.estate.id, { unitId: s.h1, kind: 'security_levy', amount: '15,000', coversFrom: '2026-10', paidOn: '2026-10-02' }, OCT)
        await recordPayment(s.fin, s.estate.id, { unitId: s.h1, kind: 'service_charge', amount: '120,000', coversFrom: '2026-01', coversTo: '2026-12', paidOn: '2026-01-20' }, OCT)
        await recordPayment(s.fin, s.estate.id, { unitId: s.h1, kind: 'security_levy', amount: '12,000', coversFrom: '2025-12', paidOn: '2025-12-05' }, OCT)
        await recordPayment(s.fin, s.estate.id, { unitId: s.h2, kind: 'security_levy', amount: '15,000', coversFrom: '2026-10', paidOn: '2026-10-09' }, OCT)
    }

    it('residents see their own totals per year and month, and where they stand now', async () => {
        const s = await setup()
        await setCharges(s)
        await history(s)
        const mine = await listUnitPayments(s.resident, s.estate.id, s.h1, OCT)
        expect(mine.byYear.map(y => [y.year, y.totalKobo])).toEqual([[2026, 15_000_000], [2025, 1_200_000]])
        const y2026 = mine.byYear[0]
        expect(y2026).toMatchObject({ securityKobo: 3_000_000, serviceKobo: 12_000_000, count: 3 })
        expect(y2026.months[0]).toMatchObject({ month: 1, serviceKobo: 12_000_000 })
        expect(y2026.months[9]).toMatchObject({ month: 10, securityKobo: 1_500_000, totalKobo: 1_500_000 })
        expect(y2026.months[10].totalKobo).toBe(0)
        expect(mine.current.find(c => c.kind === 'security_levy')).toMatchObject({ state: 'paid', period: { label: 'October 2026' } })
        expect(mine.current.find(c => c.kind === 'service_charge')).toMatchObject({ state: 'paid', period: { key: '2026' } })
    })

    it('estate totals per year and month: staff always, residents only if the estate shares them', async () => {
        const s = await setup()
        await setCharges(s)
        await history(s)
        const totals = await estateCollectionTotals(s.fin, s.estate.id)
        expect(totals[0]).toMatchObject({ year: 2026, securityKobo: 4_500_000, serviceKobo: 12_000_000, count: 4 })
        expect(totals[0].months[9]).toMatchObject({ securityKobo: 3_000_000, count: 2 })
        expect(totals[1]).toMatchObject({ year: 2025, totalKobo: 1_200_000 })

        await expect(estateCollectionTotals(s.resident, s.estate.id)).rejects.toThrow(/permission/)
        await expect(estateCollectionTotals(s.guard, s.estate.id)).rejects.toThrow(/permission/)
        await setCharges(s, { share: true })
        expect((await estateCollectionTotals(s.resident, s.estate.id))[0].totalKobo).toBe(16_500_000)
        await expect(estateCollectionTotals(s.guard, s.estate.id)).rejects.toThrow(/permission/)
    })
})
