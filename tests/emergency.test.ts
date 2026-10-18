import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { distressAlerts } from '@/db/schema'
import {
    acknowledgeDistress, addPoliceStation, cancelDistress, distanceKm, getDistressForResident, getOpenAlertForUnit, listAlerts, listOpenAlerts,
    nearestPoliceStations, raiseDistress, resolveDistress, setEstateLocation,
} from '@/lib/emergency'
import { listMyNotifications } from '@/lib/notifications'
import { addResident } from '@/lib/residents'
import { addStaff } from '@/lib/staff'

import { actorFor, createTestEstate, createUser, nextPhone, ownerDb, resetDb, useConsoleSms } from './helpers'

beforeEach(resetDb)

// Lokogoma area, Abuja (approximate)
const HOME = { latitude: 8.9806, longitude: 7.4703, accuracy: 18 }

async function setup (name = 'Sunshine Estate') {
    const t = await createTestEstate({ name, houses: '1-3' })
    const residentPhone = nextPhone()
    const occ = await addResident(t.admin, t.estate.id, { unitId: t.units[0].id, name: 'Ada Obi', phone: residentPhone, relation: 'owner' })
    const resident = actorFor(occ.userId!)
    const householdPhone = nextPhone()
    const hh = await addResident(t.admin, t.estate.id, { unitId: t.units[0].id, name: 'Chidi Obi', phone: householdPhone, relation: 'household' })
    const neighbourPhone = nextPhone()
    const nb = await addResident(t.admin, t.estate.id, { unitId: t.units[1].id, name: 'Musa Bello', phone: neighbourPhone, relation: 'owner' })
    const guardPhone = nextPhone()
    const guard = actorFor((await addStaff(t.admin, t.estate.id, { name: 'Sule Guard', phone: guardPhone, role: 'guard' })).userId)
    const fin = actorFor((await addStaff(t.admin, t.estate.id, { name: 'Grace Finance', phone: nextPhone(), role: 'finance_officer' })).userId)
    return { ...t, resident, residentPhone, household: actorFor(hh.userId!), householdPhone, neighbour: actorFor(nb.userId!), neighbourPhone, guard, guardPhone, fin, unitId: t.units[0].id }
}

async function addStations () {
    const ops = await createUser({ isPlatformAdmin: true })
    await addPoliceStation(ops, { name: 'Near Division', area: 'Lokogoma', phone: '0803 000 0001', latitude: 8.985, longitude: 7.47 })
    await addPoliceStation(ops, { name: 'Middle Division', area: 'Apo', phone: '+2349000000002', latitude: 9.0, longitude: 7.5 })
    await addPoliceStation(ops, { name: 'Far Division', area: 'Kubwa', phone: '08030000003', latitude: 9.15, longitude: 7.33 })
    return ops
}

describe('geography', () => {
    it('measures distance and orders police stations nearest first', async () => {
        expect(distanceKm({ lat: 9, lng: 7 }, { lat: 9, lng: 7 })).toBe(0)
        expect(distanceKm({ lat: 9.0, lng: 7.0 }, { lat: 10.0, lng: 7.0 })).toBeCloseTo(111.2, 0)
        await addStations()
        const near = await nearestPoliceStations(HOME.latitude, HOME.longitude, 2)
        expect(near.map(s => s.name)).toEqual(['Near Division', 'Middle Division'])
        expect(near[0].phone).toBe('08030000001')
    })

    it('only platform admins manage police stations', async () => {
        const user = await createUser()
        await expect(addPoliceStation(user, { name: 'X Division', phone: '112', latitude: 9, longitude: 7 })).rejects.toThrow(/permission/)
        const ops = await createUser({ isPlatformAdmin: true })
        await expect(addPoliceStation(ops, { name: 'Lagos?', phone: '112', latitude: 51.5, longitude: 0 })).rejects.toThrow()
    })
})

describe('distress button', () => {
    it('alerts everyone in the estate; guards get the map link and address; police are listed nearest first', async () => {
        const s = await setup()
        await addStations()
        const sms = useConsoleSms()
        const { alert, reused } = await raiseDistress(s.resident, s.estate.id, { unitId: s.unitId, ...HOME })
        expect(reused).toBe(false)
        expect(alert).toMatchObject({ status: 'active', locationSource: 'gps', latitude: HOME.latitude, accuracyMeters: 18 })
        // admin, guard, finance officer, household member, neighbour (not the person who pressed it)
        expect(alert.notifiedCount).toBe(5)

        const guardSms = sms.lastTo(s.guardPhone)!
        expect(guardSms.body).toContain('EMERGENCY')
        expect(guardSms.body).toContain('House 1, 1st Avenue, Sunshine Estate, Lokogoma, Abuja, FCT')
        expect(guardSms.body).toContain('https://www.google.com/maps/search/?api=1&query=8.980600,7.470300')
        expect(guardSms.body).toContain('Ada Obi')
        expect(sms.lastTo(s.neighbourPhone)!.body).toContain('alert raised at 1, 1st Avenue')
        expect(sms.lastTo(s.neighbourPhone)!.body).not.toContain('maps')
        expect(sms.lastTo(s.residentPhone)).toBeUndefined()

        expect((await listMyNotifications(s.guard))[0]).toMatchObject({ type: 'emergency.raised', link: `/gate/${s.estate.id}` })
        expect((await listMyNotifications(s.neighbour))[0]).toMatchObject({ type: 'emergency.raised', link: '/app' })

        const screen = await getDistressForResident(s.resident, s.estate.id, alert.id)
        expect(screen.stations.map(st => st.name)).toEqual(['Near Division', 'Middle Division', 'Far Division'])
        expect(screen.emergencyLines.map(l => l.number)).toEqual(['112', '199'])
        expect(screen.mapLink).toContain('8.980600,7.470300')

        const open = await listOpenAlerts(s.guard, s.estate.id)
        expect(open).toHaveLength(1)
        expect(open[0]).toMatchObject({ unitLabel: '1', raisedByName: 'Ada Obi' })
    })

    it('pressing again (or by another household member) re-uses the open alert without texting everyone again', async () => {
        const s = await setup()
        const sms = useConsoleSms()
        const first = await raiseDistress(s.resident, s.estate.id, { unitId: s.unitId, ...HOME })
        const count = sms.sent.length
        const again = await raiseDistress(s.household, s.estate.id, { unitId: s.unitId })
        expect(again).toMatchObject({ reused: true, alert: { id: first.alert.id } })
        expect(sms.sent.length).toBe(count)
        expect((await getOpenAlertForUnit(s.household, s.estate.id, s.unitId))?.id).toBe(first.alert.id)
    })

    it('falls back to the estate location when there is no GPS fix', async () => {
        const s = await setup()
        const { alert: noLoc } = await raiseDistress(s.resident, s.estate.id, { unitId: s.unitId })
        expect(noLoc).toMatchObject({ locationSource: 'none', latitude: null })
        await cancelDistress(s.resident, s.estate.id, noLoc.id)
        await setEstateLocation(s.admin, s.estate.id, { latitude: '9.0579', longitude: '7.4951' })
        // A position outside Nigeria is ignored
        const { alert } = await raiseDistress(s.resident, s.estate.id, { unitId: s.unitId, latitude: 51.5, longitude: -0.1 })
        expect(alert).toMatchObject({ locationSource: 'estate', latitude: 9.0579, longitude: 7.4951 })
    })

    it('guard acknowledges then resolves; the household is told help is coming', async () => {
        const s = await setup()
        const { alert } = await raiseDistress(s.resident, s.estate.id, { unitId: s.unitId, ...HOME })
        const sms = useConsoleSms()
        await expect(acknowledgeDistress(s.fin, s.estate.id, alert.id)).rejects.toThrow(/permission/)
        await acknowledgeDistress(s.guard, s.estate.id, alert.id)
        await expect(acknowledgeDistress(s.admin, s.estate.id, alert.id)).rejects.toThrow(/already responding/)
        expect(sms.lastTo(s.residentPhone)!.body).toContain('Sule Guard is responding')
        expect(sms.lastTo(s.householdPhone)).toBeDefined()
        expect(sms.lastTo(s.neighbourPhone)).toBeUndefined()

        await resolveDistress(s.guard, s.estate.id, alert.id, 'Intruder chased off, police informed')
        const [row] = await ownerDb().select().from(distressAlerts).where(eq(distressAlerts.id, alert.id))
        expect(row).toMatchObject({ status: 'resolved', closedBy: s.guard.userId, acknowledgedBy: s.guard.userId })
        expect(await listOpenAlerts(s.guard, s.estate.id)).toHaveLength(0)
        expect((await listAlerts(s.admin, s.estate.id))[0].alert.closingNote).toContain('Intruder')
        // A new alert can be raised once the last one is closed
        expect((await raiseDistress(s.resident, s.estate.id, { unitId: s.unitId })).reused).toBe(false)
    })

    it('resident cancels a false alarm and staff are told', async () => {
        const s = await setup()
        const { alert } = await raiseDistress(s.resident, s.estate.id, { unitId: s.unitId })
        const sms = useConsoleSms()
        await expect(cancelDistress(s.neighbour, s.estate.id, alert.id)).rejects.toThrow(/not found/)
        await cancelDistress(s.resident, s.estate.id, alert.id)
        expect(sms.lastTo(s.guardPhone)!.body).toContain('false alarm')
        await expect(cancelDistress(s.resident, s.estate.id, alert.id)).rejects.toThrow(/closed/)
    })

    it('only residents of the house can raise it, and other estates never see it', async () => {
        const s = await setup()
        const other = await setup('Other Estate')
        await expect(raiseDistress(s.neighbour, s.estate.id, { unitId: s.unitId })).rejects.toThrow(/Only residents/)
        await expect(raiseDistress(s.guard, s.estate.id, { unitId: s.unitId })).rejects.toThrow(/Only residents/)
        await expect(raiseDistress(other.resident, s.estate.id, { unitId: s.unitId })).rejects.toThrow(/Only residents/)
        await raiseDistress(s.resident, s.estate.id, { unitId: s.unitId })
        expect(await listOpenAlerts(other.guard, other.estate.id)).toHaveLength(0)
        await expect(listOpenAlerts(other.guard, s.estate.id)).rejects.toThrow(/permission/)
        expect((await listMyNotifications(other.guard)).some(n => n.type === 'emergency.raised')).toBe(false)
    })

    it('limits repeated alerts per person per hour', async () => {
        const s = await setup()
        const now = new Date()
        for (let i = 0; i < 5; i++) {
            const { alert } = await raiseDistress(s.resident, s.estate.id, { unitId: s.unitId }, now)
            await cancelDistress(s.resident, s.estate.id, alert.id)
        }
        await expect(raiseDistress(s.resident, s.estate.id, { unitId: s.unitId }, now)).rejects.toThrow(/several alerts/)
    })
})
