import { beforeEach, describe, expect, it } from 'vitest'

import { listPayments, listUnitPayments, paymentsByUnit, recordPayment, voidPayment } from '@/lib/levies'
import { listMyNotifications } from '@/lib/notifications'
import { addResident } from '@/lib/residents'
import { addStaff } from '@/lib/staff'

import { actorFor, createTestEstate, nextPhone, resetDb } from './helpers'

beforeEach(resetDb)

async function setup (name = 'Sunshine Estate') {
    const t = await createTestEstate({ name, houses: '1-3' })
    const occ = await addResident(t.admin, t.estate.id, { unitId: t.units[0].id, name: 'Ada Obi', phone: nextPhone(), relation: 'owner' })
    const resident = actorFor(occ.userId!)
    const fin = actorFor((await addStaff(t.admin, t.estate.id, { name: 'Grace Finance', phone: nextPhone(), role: 'finance_officer' })).userId)
    const guard = actorFor((await addStaff(t.admin, t.estate.id, { name: 'Sule Guard', phone: nextPhone(), role: 'guard' })).userId)
    return { ...t, resident, fin, guard, house1: t.units[0].id, house2: t.units[1].id }
}

describe('levy and service charge records', () => {
    it('records payments, totals them by charge and by house, and tells the residents', async () => {
        const s = await setup()
        await recordPayment(s.fin, s.estate.id, { unitId: s.house1, kind: 'security_levy', amount: '15,000', period: 'October 2026', paidOn: '2026-10-02', method: 'bank_transfer', reference: 'GTB-123' })
        await recordPayment(s.fin, s.estate.id, { unitId: s.house1, kind: 'service_charge', amount: '₦50,000.50', period: '2026', paidOn: '2026-09-15', method: 'cash' })
        await recordPayment(s.admin, s.estate.id, { unitId: s.house2, kind: 'security_levy', amount: '15000', period: 'October 2026', paidOn: '2026-10-05' })

        const all = await listPayments(s.fin, s.estate.id)
        expect(all.rows).toHaveLength(3)
        expect(all.byKind.security_levy).toEqual({ totalKobo: 3_000_000, count: 2 })
        expect(all.byKind.service_charge).toEqual({ totalKobo: 5_000_050, count: 1 })
        expect(all.totalKobo).toBe(8_000_050)

        const october = await listPayments(s.fin, s.estate.id, { from: '2026-10-01', to: '2026-10-31' })
        expect(october.rows).toHaveLength(2)
        const security = await listPayments(s.fin, s.estate.id, { kind: 'security_levy', q: '1st Avenue' })
        expect(security.rows).toHaveLength(2)

        const perHouse = await paymentsByUnit(s.fin, s.estate.id)
        expect(perHouse).toHaveLength(3) // houses with no payments are listed too
        expect(perHouse.find(r => r.unitId === s.house1)).toMatchObject({ securityKobo: 1_500_000, serviceKobo: 5_000_050, lastPaidOn: '2026-10-02' })
        expect(perHouse.find(r => r.unitId === s.units[2].id)).toMatchObject({ securityKobo: 0, serviceKobo: 0, lastPaidOn: null })

        const mine = await listUnitPayments(s.resident, s.estate.id, s.house1)
        expect(mine.rows).toHaveLength(2)
        expect(mine.securityKobo).toBe(1_500_000)
        const notes = await listMyNotifications(s.resident)
        expect(notes.map(n => n.type)).toEqual(['payment.recorded', 'payment.recorded'])
        expect(notes.some(n => n.body.includes('15,000') && n.body.includes('security levy'))).toBe(true)
    })

    it('voids a payment with a reason: excluded from totals, kept in history', async () => {
        const s = await setup()
        const p = await recordPayment(s.fin, s.estate.id, { unitId: s.house1, kind: 'security_levy', amount: '150000', period: 'October 2026', paidOn: '2026-10-02' })
        await expect(voidPayment(s.fin, s.estate.id, p.id, 'no')).rejects.toThrow(/reason/)
        await voidPayment(s.fin, s.estate.id, p.id, 'Typed an extra zero')
        await expect(voidPayment(s.fin, s.estate.id, p.id, 'Typed an extra zero')).rejects.toThrow(/already voided/)
        expect((await listPayments(s.fin, s.estate.id)).rows).toHaveLength(0)
        const withVoided = await listPayments(s.fin, s.estate.id, { includeVoided: true })
        expect(withVoided.rows[0].payment.voidReason).toBe('Typed an extra zero')
        expect(withVoided.totalKobo).toBe(0)
        expect((await listUnitPayments(s.resident, s.estate.id, s.house1)).securityKobo).toBe(0)
    })

    it('rejects bad amounts and future dates', async () => {
        const s = await setup()
        const base = { unitId: s.house1, kind: 'security_levy' as const, period: 'October 2026', paidOn: '2026-10-02' }
        await expect(recordPayment(s.fin, s.estate.id, { ...base, amount: '0' })).rejects.toThrow()
        await expect(recordPayment(s.fin, s.estate.id, { ...base, amount: 'abc' })).rejects.toThrow()
        await expect(recordPayment(s.fin, s.estate.id, { ...base, amount: '500,000,000' })).rejects.toThrow()
        await expect(recordPayment(s.fin, s.estate.id, { ...base, amount: '1000', paidOn: '2026-10-20' }, new Date('2026-10-18T10:00:00Z'))).rejects.toThrow(/future/)
    })

    it('only finance staff record; guards and other houses cannot see records', async () => {
        const s = await setup()
        const other = await setup('Other Estate')
        const input = { unitId: s.house1, kind: 'security_levy' as const, amount: '1000', period: 'Oct', paidOn: '2026-10-02' }
        await expect(recordPayment(s.guard, s.estate.id, input)).rejects.toThrow(/permission/)
        await expect(recordPayment(s.resident, s.estate.id, input)).rejects.toThrow(/permission/)
        await expect(listPayments(s.guard, s.estate.id)).rejects.toThrow(/permission/)
        await expect(listUnitPayments(s.resident, s.estate.id, s.house2)).rejects.toThrow(/permission/)
        // Another estate's finance officer cannot record against this estate's house
        await expect(recordPayment(other.fin, s.estate.id, input)).rejects.toThrow(/permission/)
        await expect(recordPayment(other.fin, other.estate.id, input)).rejects.toThrow(/not found/)
    })
})
