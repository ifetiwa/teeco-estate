import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { visitorPasses, visits } from '@/db/schema'
import { isWithinDailyWindow, parseLagosDateTime, toLagosInputValue } from '@/lib/format'
import { listMyNotifications } from '@/lib/notifications'
import { addResident } from '@/lib/residents'
import { addStaff } from '@/lib/staff'
import {
    GATE_MAX_FAILURES, blockVisitor, cancelPass, checkInApprovedWalkIn, checkInWithPass, checkOutVisit, createPass, decideWalkIn, denyPassEntry,
    exportVisitorLogCsv, getGateBoard, listVisitorLog, listWalkInRequestsForResident, logWalkIn, parseGateInput, passQrPayload, updateVisitorRules,
    verifyGateCode,
} from '@/lib/visitors'

import { actorFor, createTestEstate, nextPhone, ownerDb, resetDb, useConsoleSms } from './helpers'

beforeEach(resetDb)

const DEVICE = 'device-test-0001'

/** An estate with an admin, a guard, and a resident (with an account) at house 1. */
async function setup (name = 'Sunshine Estate') {
    const t = await createTestEstate({ name, houses: '1-3' })
    const residentPhone = nextPhone()
    const occ = await addResident(t.admin, t.estate.id, { unitId: t.units[0].id, name: 'Ada Obi', phone: residentPhone, relation: 'owner' })
    const resident = actorFor(occ.userId!)
    const guardPhone = nextPhone()
    const m = await addStaff(t.admin, t.estate.id, { name: 'Sule Guard', phone: guardPhone, role: 'guard' })
    const guard = actorFor(m.userId)
    return { ...t, resident, residentPhone, guard, unitId: t.units[0].id }
}

/** Lagos-local datetime strings relative to now */
function lagos (offsetMinutes: number, base = new Date()): string {
    return toLagosInputValue(new Date(base.getTime() + offsetMinutes * 60_000))
}

describe('time helpers', () => {
    it('converts Lagos local time to UTC (UTC+1, no DST)', () => {
        expect(parseLagosDateTime('2026-10-14T18:30')!.toISOString()).toBe('2026-10-14T17:30:00.000Z')
        expect(parseLagosDateTime('2026-02-30T10:00')).toBeNull()
        expect(toLagosInputValue(new Date('2026-10-14T23:30:00Z'))).toBe('2026-10-15T00:30')
    })

    it('handles curfew windows across midnight', () => {
        expect(isWithinDailyWindow(new Date('2026-10-14T22:30:00Z'), '23:00', '05:00')).toBe(true) // 23:30 Lagos
        expect(isWithinDailyWindow(new Date('2026-10-15T03:59:00Z'), '23:00', '05:00')).toBe(true) // 04:59
        expect(isWithinDailyWindow(new Date('2026-10-15T04:00:00Z'), '23:00', '05:00')).toBe(false) // 05:00
        expect(isWithinDailyWindow(new Date('2026-10-14T12:00:00Z'), '23:00', '05:00')).toBe(false)
    })

    it('parses typed codes and QR payloads', () => {
        expect(parseGateInput(' 123 456 ')).toEqual({ code: '123456' })
        expect(parseGateInput('12345')).toBeNull()
        const id = '0b9f5c1e-3c1a-4d5e-9f00-111122223333'
        expect(parseGateInput(`TEECO-PASS:${id}:654321`)).toEqual({ passId: id, code: '654321' })
    })
})

describe('Build 4 done-when: pass → gate → notification → check-out', () => {
    it('runs end to end', async () => {
        const s = await setup()
        const pass = await createPass(s.resident, s.estate.id, {
            unitId: s.unitId, visitorName: 'Kemi Adebayo', visitorPhone: '0809 111 2222', purpose: 'Birthday', validFrom: lagos(-5), validUntil: lagos(180), usage: 'single',
        })
        expect(pass.code).toMatch(/^\d{6}$/)
        expect(pass.visitorPhone).toBe('+2348091112222')

        // Guard scans the QR
        const hit = await verifyGateCode(s.guard, s.estate.id, passQrPayload(pass), DEVICE)
        expect(hit).toMatchObject({ ok: true, unitLabel: '1', zoneName: '1st Avenue', residentName: 'Ada Obi' })

        const visit = await checkInWithPass(s.guard, s.estate.id, pass.id, 1)
        expect(visit).toMatchObject({ status: 'checked_in', kind: 'pass', gate: 1 })

        let notes = await listMyNotifications(s.resident)
        expect(notes[0]).toMatchObject({ type: 'visitor.arrived', title: 'Kemi Adebayo has arrived' })

        const board = await getGateBoard(s.guard, s.estate.id)
        expect(board.inside.map(r => r.visit.id)).toEqual([visit.id])

        const out = await checkOutVisit(s.guard, s.estate.id, visit.id)
        expect(out.status).toBe('checked_out')
        expect(out.checkedOutAt).toBeInstanceOf(Date)
        notes = await listMyNotifications(s.resident)
        expect(notes[0]).toMatchObject({ type: 'visitor.left', title: 'Kemi Adebayo has left' })

        const log = await listVisitorLog(s.admin, s.estate.id)
        expect(log).toHaveLength(1)
        expect(log[0].visit).toMatchObject({ status: 'checked_out', visitorName: 'Kemi Adebayo' })
    })
})

describe('code rejection messages', () => {
    it('rejects used single-use codes, and a single-use pass admits only once', async () => {
        const s = await setup()
        const pass = await createPass(s.resident, s.estate.id, { unitId: s.unitId, visitorName: 'Visitor One', validFrom: lagos(-5), validUntil: lagos(60) })
        await checkInWithPass(s.guard, s.estate.id, pass.id, 1)
        const again = await verifyGateCode(s.guard, s.estate.id, pass.code, DEVICE)
        expect(again).toMatchObject({ ok: false, reason: 'used', message: 'This pass has already been used.' })
        await expect(checkInWithPass(s.guard, s.estate.id, pass.id, 1)).rejects.toThrow('already been used')
    })

    it('two guards admitting the same single-use pass at once: only one succeeds', async () => {
        const s = await setup()
        const pass = await createPass(s.resident, s.estate.id, { unitId: s.unitId, visitorName: 'Race Visitor', validFrom: lagos(-5), validUntil: lagos(60) })
        const results = await Promise.allSettled([checkInWithPass(s.guard, s.estate.id, pass.id, 1), checkInWithPass(s.guard, s.estate.id, pass.id, 2)])
        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
        const rows = await ownerDb().select().from(visits).where(eq(visits.passId, pass.id))
        expect(rows).toHaveLength(1)
    })

    it('rejects expired and not-yet-valid codes with times', async () => {
        const s = await setup()
        const later = await createPass(s.resident, s.estate.id, { unitId: s.unitId, visitorName: 'Tomorrow Guest', validFrom: lagos(24 * 60), validUntil: lagos(25 * 60) })
        expect(await verifyGateCode(s.guard, s.estate.id, later.code, DEVICE)).toMatchObject({ ok: false, reason: 'not_yet_valid', message: expect.stringContaining('not valid until') })
        const soon = await createPass(s.resident, s.estate.id, { unitId: s.unitId, visitorName: 'Short Guest', validFrom: lagos(-5), validUntil: lagos(30) })
        const afterExpiry = new Date(Date.now() + 2 * 3_600_000)
        expect(await verifyGateCode(s.guard, s.estate.id, soon.code, DEVICE, afterExpiry)).toMatchObject({ ok: false, reason: 'expired', message: expect.stringContaining('expired at') })
    })

    it('rejects cancelled codes', async () => {
        const s = await setup()
        const pass = await createPass(s.resident, s.estate.id, { unitId: s.unitId, visitorName: 'Cancelled Guest', validFrom: lagos(-5), validUntil: lagos(60) })
        await cancelPass(s.resident, s.estate.id, pass.id)
        expect(await verifyGateCode(s.guard, s.estate.id, pass.code, DEVICE)).toMatchObject({ ok: false, reason: 'cancelled' })
    })

    it('rejects a code from another estate with a clear message, by typed code and by QR', async () => {
        const a = await setup('Estate A')
        const b = await setup('Estate B')
        const passB = await createPass(b.resident, b.estate.id, { unitId: b.unitId, visitorName: 'B Visitor', validFrom: lagos(-5), validUntil: lagos(60) })
        // Make sure estate A has no pass with the same code
        const typed = await verifyGateCode(a.guard, a.estate.id, passB.code, DEVICE)
        expect(typed).toMatchObject({ ok: false, reason: 'wrong_estate', message: 'This code is for a different estate. It cannot be used here.' })
        expect(typed).not.toHaveProperty('pass')
        expect(await verifyGateCode(a.guard, a.estate.id, passQrPayload(passB), DEVICE)).toMatchObject({ ok: false, reason: 'wrong_estate' })
        await expect(checkInWithPass(a.guard, a.estate.id, passB.id, 1)).rejects.toThrow('not found')
        expect(await verifyGateCode(a.guard, a.estate.id, '000000' === passB.code ? '111111' : '000000', DEVICE)).toMatchObject({ ok: false, reason: 'not_found' })
    })

    it('locks a guard device after too many failed codes', async () => {
        const s = await setup()
        for (let i = 0; i < GATE_MAX_FAILURES; i++) {
            expect((await verifyGateCode(s.guard, s.estate.id, `99999${i}`, DEVICE)).ok).toBe(false)
        }
        await expect(verifyGateCode(s.guard, s.estate.id, '123456', DEVICE)).rejects.toThrow('Too many wrong codes on this device')
        // another device is not affected
        expect((await verifyGateCode(s.guard, s.estate.id, '123456', 'device-other-0002')).ok).toBe(false)
    })
})

describe('walk-ins', () => {
    it('guard logs a walk-in, resident is asked by SMS and in-app, approves, guard admits', async () => {
        const sms = useConsoleSms()
        const s = await setup()
        const visit = await logWalkIn(s.guard, s.estate.id, { unitId: s.unitId, visitorName: 'Delivery Man', purpose: 'Parcel', gate: 2 })
        expect(visit.status).toBe('awaiting_resident')
        expect(sms.lastTo(s.residentPhone)?.body).toContain('Delivery Man is at gate 2')
        expect((await listWalkInRequestsForResident(s.resident, s.estate.id)).map(v => v.id)).toEqual([visit.id])

        await expect(checkInApprovedWalkIn(s.guard, s.estate.id, visit.id)).rejects.toThrow('not answered yet')
        await decideWalkIn(s.resident, s.estate.id, visit.id, true)
        expect((await getGateBoard(s.guard, s.estate.id)).approved.map(r => r.visit.id)).toEqual([visit.id])
        const inVisit = await checkInApprovedWalkIn(s.guard, s.estate.id, visit.id)
        expect(inVisit.status).toBe('checked_in')
    })

    it('declined walk-ins cannot be admitted; only the unit\'s residents can answer', async () => {
        const s = await setup()
        const visit = await logWalkIn(s.guard, s.estate.id, { unitId: s.unitId, visitorName: 'Unknown Caller', gate: 1 })
        const neighbour = await addResident(s.admin, s.estate.id, { unitId: s.units[1].id, name: 'Neighbour', phone: nextPhone(), relation: 'owner' })
        await expect(decideWalkIn(actorFor(neighbour.userId!), s.estate.id, visit.id, true)).rejects.toThrow('Only residents of this house')
        await expect(decideWalkIn(s.guard, s.estate.id, visit.id, true)).rejects.toThrow('Only residents of this house')
        await decideWalkIn(s.resident, s.estate.id, visit.id, false, 'Not expecting anyone')
        await expect(checkInApprovedWalkIn(s.guard, s.estate.id, visit.id)).rejects.toThrow('did not approve')
        await expect(decideWalkIn(s.resident, s.estate.id, visit.id, true)).rejects.toThrow('already been answered')
    })

    it('cannot log a walk-in to an empty house', async () => {
        const s = await setup()
        await expect(logWalkIn(s.guard, s.estate.id, { unitId: s.units[2].id, visitorName: 'Ghost Visit', gate: 1 })).rejects.toThrow('Nobody is registered')
    })
})

describe('estate rules', () => {
    it('limits passes per resident per day', async () => {
        const s = await setup()
        await updateVisitorRules(s.admin, s.estate.id, { maxPassesPerResidentPerDay: 2, curfewStart: '23:00', curfewEnd: '05:00' })
        await createPass(s.resident, s.estate.id, { unitId: s.unitId, visitorName: 'Guest One', validFrom: lagos(0), validUntil: lagos(60) })
        await createPass(s.resident, s.estate.id, { unitId: s.unitId, visitorName: 'Guest Two', validFrom: lagos(0), validUntil: lagos(60) })
        await expect(createPass(s.resident, s.estate.id, { unitId: s.unitId, visitorName: 'Guest Three', validFrom: lagos(0), validUntil: lagos(60) })).rejects.toThrow('up to 2 passes a day')
    })

    it('blocked visitors cannot get passes or walk in; existing passes are refused at the gate', async () => {
        const s = await setup()
        const pass = await createPass(s.resident, s.estate.id, { unitId: s.unitId, visitorName: 'Trouble Maker', visitorPhone: '08012345678', validFrom: lagos(-5), validUntil: lagos(60) })
        await blockVisitor(s.admin, s.estate.id, { phone: '0801 234 5678', reason: 'Theft reported' })
        expect(await verifyGateCode(s.guard, s.estate.id, pass.code, DEVICE)).toMatchObject({ ok: false, reason: 'blocked', message: 'Blocked by the estate: Theft reported' })
        await expect(createPass(s.resident, s.estate.id, { unitId: s.unitId, visitorName: 'Another Name', visitorPhone: '08012345678', validFrom: lagos(0), validUntil: lagos(60) })).rejects.toThrow('blocked')
        await blockVisitor(s.admin, s.estate.id, { name: 'Bad Guy', reason: 'Fight at gate' })
        await expect(logWalkIn(s.guard, s.estate.id, { unitId: s.unitId, visitorName: 'bad guy', gate: 1 })).rejects.toThrow('blocked')
        await expect(blockVisitor(s.guard, s.estate.id, { name: 'X', reason: 'abc' })).rejects.toThrow('permission')
    })

    it('enforces curfew at the gate', async () => {
        const s = await setup()
        await updateVisitorRules(s.admin, s.estate.id, { maxPassesPerResidentPerDay: 10, curfewEnabled: 'on', curfewStart: '23:00', curfewEnd: '05:00' })
        const midnight = new Date('2030-01-01T23:30:00Z') // 00:30 Lagos
        const pass = await createPass(s.resident, s.estate.id, {
            unitId: s.unitId, visitorName: 'Late Guest', validFrom: toLagosInputValue(new Date(midnight.getTime() - 3_600_000)), validUntil: toLagosInputValue(new Date(midnight.getTime() + 3_600_000)),
        }, new Date(midnight.getTime() - 3_600_000))
        expect(await verifyGateCode(s.guard, s.estate.id, pass.code, DEVICE, midnight)).toMatchObject({ ok: false, reason: 'curfew' })
        await expect(checkInWithPass(s.guard, s.estate.id, pass.id, 1, midnight)).rejects.toThrow('Curfew')
    })

    it('denials are logged; the log can be searched and exported safely', async () => {
        const s = await setup()
        const pass = await createPass(s.resident, s.estate.id, { unitId: s.unitId, visitorName: '=HYPERLINK("x")', vehiclePlate: 'abc-123de', validFrom: lagos(-5), validUntil: lagos(60) })
        await denyPassEntry(s.guard, s.estate.id, pass.id, 'No ID card', 1)
        expect((await listVisitorLog(s.admin, s.estate.id, { q: 'ABC123' }))).toHaveLength(1)
        expect((await listVisitorLog(s.admin, s.estate.id, { q: 'nobody' }))).toHaveLength(0)
        const csv = await exportVisitorLogCsv(s.admin, s.estate.id)
        expect(csv.split('\r\n')[0]).toContain('Visitor,Phone,Vehicle,House')
        expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
        expect(csv).toContain('Denied at gate')
        await expect(listVisitorLog(s.resident, s.estate.id)).rejects.toThrow('permission')
    })
})

describe('permissions', () => {
    it('only residents of a unit create passes for it; guards cannot create passes; residents cannot operate the gate', async () => {
        const s = await setup()
        await expect(createPass(s.resident, s.estate.id, { unitId: s.units[1].id, visitorName: 'Not Mine', validFrom: lagos(0), validUntil: lagos(60) })).rejects.toThrow('Only residents')
        await expect(createPass(s.guard, s.estate.id, { unitId: s.unitId, visitorName: 'Guard Guest', validFrom: lagos(0), validUntil: lagos(60) })).rejects.toThrow('Only residents')
        await expect(verifyGateCode(s.resident, s.estate.id, '123456', DEVICE)).rejects.toThrow('permission')
        await expect(getGateBoard(s.admin, s.estate.id)).resolves.toBeTruthy() // estate admins can cover the gate
        const rows = await ownerDb().select().from(visitorPasses)
        expect(rows).toHaveLength(0)
    })

    it('validates pass windows', async () => {
        const s = await setup()
        await expect(createPass(s.resident, s.estate.id, { unitId: s.unitId, visitorName: 'Backwards', validFrom: lagos(60), validUntil: lagos(30) })).rejects.toThrow('after the start')
        await expect(createPass(s.resident, s.estate.id, { unitId: s.unitId, visitorName: 'Too Long', validFrom: lagos(0), validUntil: lagos(60 * 24 * 40) })).rejects.toThrow('at most 31 days')
        await expect(createPass(s.resident, s.estate.id, { unitId: s.unitId, visitorName: 'Past', validFrom: lagos(-300), validUntil: lagos(-200) })).rejects.toThrow('already passed')
    })
})

describe('updates for the security team', () => {
    it('guards are told about expected visitors and residents\' answers at the gate', async () => {
        const s = await setup()
        await createPass(s.resident, s.estate.id, { unitId: s.unitId, visitorName: 'Kemi Adebayo', validFrom: lagos(-5), validUntil: lagos(180), vehiclePlate: 'ABC-123DE' })
        const [expected] = await listMyNotifications(s.guard)
        expect(expected).toMatchObject({ type: 'visitor.expected', title: 'Expected visitor: Kemi Adebayo', link: `/security/${s.estate.id}` })
        expect(expected.body).toContain('1, 1st Avenue')
        expect(expected.body).toContain('ABC123DE')

        const walkIn = await logWalkIn(s.guard, s.estate.id, { unitId: s.unitId, visitorName: 'Glovo Rider', gate: 1 })
        await decideWalkIn(s.resident, s.estate.id, walkIn.id, false, 'Not expecting anyone')
        const [answer] = await listMyNotifications(s.guard)
        expect(answer).toMatchObject({ type: 'visitor.walk_in_declined', title: 'Do not admit: Glovo Rider' })
        // The estate admin is not a guard, so isn't sent these
        expect((await listMyNotifications(s.admin)).some(n => n.type.startsWith('visitor.'))).toBe(false)
    })
})
