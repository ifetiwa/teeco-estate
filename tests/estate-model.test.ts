import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { memberships, vehicles } from '@/db/schema'
import { createEstate, findEstateByJoinCode, listAllEstates, listMyEstates, regenerateJoinCode } from '@/lib/estates'
import {
    addHelper, addResident, addVehicle, approveResident, countResidents, listMyOccupancies, listPendingResidents,
    listResidents, moveOutResident, registerAsResident, rejectResident, removeVehicle, setPrimaryContact,
} from '@/lib/residents'
import { addUnits, createZone, getUnitDetail, listZonesWithUnits, parseUnitLabels, setUnitActive } from '@/lib/structure'

import { accessOf, createTestEstate, createUser, nextPhone, ownerDb, resetDb } from './helpers'

beforeEach(resetDb)

describe('parseUnitLabels', () => {
    it('expands ranges, keeps prefixes and removes duplicates', () => {
        expect(parseUnitLabels('1-3, 5, 7A')).toEqual(['1', '2', '3', '5', '7A'])
        expect(parseUnitLabels('B1-B3\nB3; Block C')).toEqual(['B1', 'B2', 'B3', 'Block C'])
    })

    it('rejects backwards and oversized ranges', () => {
        expect(() => parseUnitLabels('10-1')).toThrow('backwards')
        expect(() => parseUnitLabels('1-1000')).toThrow('too large')
    })
})

describe('estates', () => {
    it('only a platform admin can create an estate; the named person becomes estate admin', async () => {
        const nobody = await createUser()
        await expect(createEstate(nobody, { name: 'X Estate', gateCount: 1, adminName: 'A B', adminPhone: nextPhone() })).rejects.toThrow('permission')

        const { estate, admin } = await createTestEstate()
        expect(estate.joinCode).toMatch(/^[A-Z0-9]{6}$/)
        expect(estate.city).toBe('Abuja')
        expect((await accessOf(admin, estate.id)).staffRoles).toEqual(['estate_admin'])
        expect(await listMyEstates(admin)).toEqual([{ id: estate.id, name: 'Sunshine Estate', staffRoles: ['estate_admin'], residentStatus: null }])
    })

    it('validates estate input', async () => {
        const platform = await createUser({ isPlatformAdmin: true })
        await expect(createEstate(platform, { name: 'Y', gateCount: 1, adminName: 'A B', adminPhone: '12345' })).rejects.toThrow()
        await expect(createEstate(platform, { name: 'Y Estate', gateCount: 0, adminName: 'A B', adminPhone: nextPhone() })).rejects.toThrow()
    })

    it('join codes find the estate and its units; codes can be regenerated', async () => {
        const { estate, admin } = await createTestEstate({ houses: '1-3' })
        const found = await findEstateByJoinCode(estate.joinCode.toLowerCase())
        expect(found.estate.name).toBe('Sunshine Estate')
        expect(found.units.map(u => u.unitLabel)).toEqual(['1', '2', '3'])

        const newCode = await regenerateJoinCode(admin, estate.id)
        expect(newCode).not.toBe(estate.joinCode)
        await expect(findEstateByJoinCode(estate.joinCode)).rejects.toThrow('No estate uses that join code')
    })

    it('platform admin list shows estate counts only', async () => {
        const { platform, estate } = await createTestEstate({ houses: '1-4' })
        const list = await listAllEstates(platform)
        expect(list).toEqual([expect.objectContaining({ id: estate.id, unitCount: 4 })])
        expect(Object.keys(list[0])).not.toContain('joinCode')
    })
})

describe('streets, blocks and units', () => {
    it('adds units, skips existing labels and sorts naturally', async () => {
        const { estate, admin, zone } = await createTestEstate({ houses: '1-3' })
        const res = await addUnits(admin, estate.id, { zoneId: zone.id, labels: '2-4, 10' })
        expect(res.created.map(c => c.label)).toEqual(['4', '10'])
        expect(res.skipped).toEqual(['2', '3'])
        const [z] = await listZonesWithUnits(admin, estate.id)
        expect(z.units.map(u => u.label)).toEqual(['1', '2', '3', '4', '10'])
    })

    it('rejects duplicate street names and other estates\' admins', async () => {
        const a = await createTestEstate({ name: 'Estate A' })
        const b = await createTestEstate({ name: 'Estate B' })
        await expect(createZone(a.admin, a.estate.id, { name: '1ST AVENUE' })).rejects.toThrow('already exists')
        await expect(createZone(b.admin, a.estate.id, { name: 'Close 9' })).rejects.toThrow('permission')
        await expect(addUnits(a.admin, a.estate.id, { zoneId: b.zone.id, labels: '99' })).rejects.toThrow('not found')
    })
})

describe('residents', () => {
    it('admin adds residents: first one becomes primary contact, primary can be changed', async () => {
        const { estate, admin, units } = await createTestEstate()
        const unitId = units[0].id
        const r1 = await addResident(admin, estate.id, { unitId, name: 'Ada Obi', phone: '08031110001', relation: 'owner' })
        const r2 = await addResident(admin, estate.id, { unitId, name: 'Chidi Obi', phone: '08031110002', relation: 'household' })
        expect(r1).toMatchObject({ status: 'active', isPrimary: true, phone: '+2348031110001' })
        expect(r2.isPrimary).toBe(false)

        await setPrimaryContact(admin, estate.id, r2.id)
        const detail = await getUnitDetail(admin, estate.id, unitId)
        expect(detail.occupants.find(o => o.isPrimary)?.id).toBe(r2.id)

        await expect(addResident(admin, estate.id, { unitId, name: 'Ada Again', phone: '0803 111 0001', relation: 'owner' })).rejects.toThrow('already registered')
    })

    it('self-registration with join code lands in the approval queue; approve and reject', async () => {
        const { estate, admin, units } = await createTestEstate()
        const resident = await createUser({ name: '' })
        const occ = await registerAsResident(resident, { joinCode: estate.joinCode, unitId: units[1].id, name: 'Musa Danjuma', relation: 'tenant' })
        expect(occ.status).toBe('pending')
        expect((await accessOf(resident, estate.id)).residentUnitIds).toEqual([])
        expect((await listMyEstates(resident))[0].residentStatus).toBe('pending')

        const queue = await listPendingResidents(admin, estate.id)
        expect(queue).toEqual([expect.objectContaining({ id: occ.id, name: 'Musa Danjuma', unitLabel: '2', zoneName: '1st Avenue' })])

        const approved = await approveResident(admin, estate.id, occ.id)
        expect(approved).toMatchObject({ status: 'active', isPrimary: true, reviewedBy: admin.userId })
        expect((await accessOf(resident, estate.id)).residentUnitIds).toEqual([units[1].id])
        await expect(approveResident(admin, estate.id, occ.id)).rejects.toThrow('already been handled')

        const other = await createUser()
        const occ2 = await registerAsResident(other, { joinCode: estate.joinCode, unitId: units[2].id, name: 'Not Real', relation: 'owner' })
        await expect(rejectResident(admin, estate.id, occ2.id, '')).rejects.toThrow('reason')
        await rejectResident(admin, estate.id, occ2.id, 'Not on our records')
        const mine = await listMyOccupancies(other)
        expect(mine[0]).toMatchObject({ status: 'rejected', rejectionReason: 'Not on our records' })
    })

    it('registration refuses units from another estate and wrong join codes', async () => {
        const a = await createTestEstate({ name: 'Estate A' })
        const b = await createTestEstate({ name: 'Estate B' })
        const user = await createUser()
        await expect(registerAsResident(user, { joinCode: a.estate.joinCode, unitId: b.units[0].id, name: 'Sam Eze', relation: 'owner' })).rejects.toThrow('Choose a house')
        await expect(registerAsResident(user, { joinCode: 'ZZZZZZ', unitId: a.units[0].id, name: 'Sam Eze', relation: 'owner' })).rejects.toThrow('No estate uses')
    })

    it('only estate admins approve; residents cannot see the queue', async () => {
        const { estate, units } = await createTestEstate()
        const user = await createUser()
        const occ = await registerAsResident(user, { joinCode: estate.joinCode, unitId: units[0].id, name: 'Sam Eze', relation: 'owner' })
        await expect(approveResident(user, estate.id, occ.id)).rejects.toThrow('permission')
        await expect(listPendingResidents(user, estate.id)).rejects.toThrow('permission')
    })

    it('move-out ends access, keeps history, hands primary on, and clears an empty unit', async () => {
        const { estate, admin, units } = await createTestEstate()
        const unitId = units[0].id
        const owner = await addResident(admin, estate.id, { unitId, name: 'Ada Obi', phone: '08031110001', relation: 'owner', moveInDate: '2024-01-10' })
        const spouse = await addResident(admin, estate.id, { unitId, name: 'Chidi Obi', phone: '08031110002', relation: 'household' })
        await addVehicle(admin, estate.id, { unitId, plate: 'abc-123de', make: 'Toyota', colour: 'Black' })

        await expect(moveOutResident(admin, estate.id, owner.id, '2023-12-31')).rejects.toThrow('before the move-in')
        const moved = await moveOutResident(admin, estate.id, owner.id, '2026-09-30')
        expect(moved).toMatchObject({ status: 'moved_out', moveOutDate: '2026-09-30', isPrimary: false })
        const ownerUser = actorForOccupancy(moved.userId!)
        expect((await accessOf(ownerUser, estate.id)).residentUnitIds).toEqual([])

        let detail = await getUnitDetail(admin, estate.id, unitId)
        expect(detail.occupants.find(o => o.id === spouse.id)?.isPrimary).toBe(true)
        expect(detail.occupants).toHaveLength(2) // history kept
        expect(detail.vehicles).toHaveLength(1)

        await moveOutResident(admin, estate.id, spouse.id)
        detail = await getUnitDetail(admin, estate.id, unitId)
        expect(detail.vehicles).toHaveLength(0)
        expect((await listResidents(admin, estate.id, { includePast: true })).map(r => r.status)).toEqual(['moved_out', 'moved_out'])
        expect(await listResidents(admin, estate.id)).toEqual([])
    })

    it('a unit with residents cannot be deactivated', async () => {
        const { estate, admin, units } = await createTestEstate()
        await addResident(admin, estate.id, { unitId: units[0].id, name: 'Ada Obi', phone: nextPhone(), relation: 'owner' })
        await expect(setUnitActive(admin, estate.id, units[0].id, false)).rejects.toThrow('Move out')
        await setUnitActive(admin, estate.id, units[1].id, false)
    })
})

describe('vehicles and domestic staff', () => {
    it('residents manage their own unit only; plates are normalised and unique per estate', async () => {
        const { estate, admin, units } = await createTestEstate()
        const resident = await createUser()
        const occ = await registerAsResident(resident, { joinCode: estate.joinCode, unitId: units[0].id, name: 'Sam Eze', relation: 'owner' })
        await expect(addVehicle(resident, estate.id, { unitId: units[0].id, plate: 'KUJ 456 AB' })).rejects.toThrow('permission') // still pending
        await approveResident(admin, estate.id, occ.id)

        const v = await addVehicle(resident, estate.id, { unitId: units[0].id, plate: 'kuj 456 ab', make: 'Honda', colour: 'Silver' })
        expect(v.plate).toBe('KUJ456AB')
        await expect(addVehicle(admin, estate.id, { unitId: units[1].id, plate: 'KUJ-456-AB' })).rejects.toThrow('already registered')
        await expect(addVehicle(resident, estate.id, { unitId: units[1].id, plate: 'ABC123XY' })).rejects.toThrow('permission')
        await expect(addVehicle(resident, estate.id, { unitId: units[0].id, plate: '!!' })).rejects.toThrow()

        const h = await addHelper(resident, estate.id, { unitId: units[0].id, name: 'Blessing', phone: '08091234567', role: 'nanny' })
        expect(h.phone).toBe('+2348091234567')

        await removeVehicle(resident, estate.id, v.id)
        const [row] = await ownerDb().select().from(vehicles).where(eq(vehicles.id, v.id))
        expect(row.isActive).toBe(false)
    })
})

describe('Build 2 done-when: an estate with 20 units and 40 residents', () => {
    it('can be set up through the domain API the UI uses', async () => {
        const platform = await createUser({ isPlatformAdmin: true })
        const adminPhone = nextPhone()
        const estate = await createEstate(platform, { name: 'Palm Springs Estate', district: 'Gwarinpa', gateCount: 2, adminName: 'Mrs Okafor', adminPhone })
        const [m] = await ownerDb().select().from(memberships).where(eq(memberships.estateId, estate.id))
        const admin = { userId: m.userId, isPlatformAdmin: false }

        const streetA = await createZone(admin, estate.id, { name: 'Palm Close', kind: 'close' })
        const streetB = await createZone(admin, estate.id, { name: 'Block D', kind: 'block' })
        const a = await addUnits(admin, estate.id, { zoneId: streetA.id, labels: '1-10', type: 'duplex' })
        const b = await addUnits(admin, estate.id, { zoneId: streetB.id, labels: 'Flat 1-Flat 10', type: 'flat' })
        const allUnits = [...a.created, ...b.created]
        expect(allUnits).toHaveLength(20)

        let n = 0
        for (const unit of allUnits) {
            for (const relation of ['owner', 'household'] as const) {
                n++
                await addResident(admin, estate.id, { unitId: unit.id, name: `Resident ${n}`, phone: nextPhone(), relation })
            }
        }
        expect(await countResidents(admin, estate.id)).toEqual({ active: 40, pending: 0 })
        const zonesList = await listZonesWithUnits(admin, estate.id)
        expect(zonesList.flatMap(z => z.units).every(u => u.occupantCount === 2)).toBe(true)
    })
})

function actorForOccupancy (userId: string) {
    return { userId, isPlatformAdmin: false }
}
