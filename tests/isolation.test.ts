import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb, withDbContext } from '@/db'
import { auditLogs, estates, memberships, occupancies, supportAccessGrants, units, vehicles, zones } from '@/db/schema'
import { ROLE_CAPABILITIES } from '@/lib/access'
import { listAuditLog } from '@/lib/audit'
import { getEstateForStaff, listAllEstates, regenerateJoinCode, updateEstateDetails } from '@/lib/estates'
import {
    addResident, addVehicle, approveResident, countResidents, listPendingResidents, listResidents, moveOutResident, registerAsResident, setPrimaryContact,
} from '@/lib/residents'
import { addStaff, listStaff, removeStaff } from '@/lib/staff'
import { addUnits, createZone, getUnitDetail, listZonesWithUnits, setUnitActive } from '@/lib/structure'
import { grantSupportAccess, listSupportGrants, revokeSupportAccess } from '@/lib/support'

import { accessOf, actorFor, createTestEstate, createUser, nextPhone, ownerDb, resetDb } from './helpers'

beforeEach(resetDb)

/** Postgres insufficient_privilege (42501): raised for RLS WITH CHECK failures and when RLS cannot be bypassed */
function isRlsViolation (e: unknown): boolean {
    const err = e as { code?: string, cause?: { code?: string } }
    return (err.cause?.code ?? err.code) === '42501'
}

async function twoEstates () {
    const a = await createTestEstate({ name: 'Estate A', houses: '1-3' })
    const b = await createTestEstate({ name: 'Estate B', houses: '1-3' })
    const residentB = await addResident(b.admin, b.estate.id, { unitId: b.units[0].id, name: 'Bola B', phone: nextPhone(), relation: 'owner' })
    await addVehicle(b.admin, b.estate.id, { unitId: b.units[0].id, plate: 'BBB111BB' })
    return { a, b, residentB }
}

describe('row-level security (database layer)', () => {
    it('the app role sees nothing from estate tables without a context', async () => {
        await twoEstates()
        const db = getDb() // connects as the restricted app role
        expect(await db.select().from(units)).toEqual([])
        expect(await db.select().from(occupancies)).toEqual([])
        expect(await db.select().from(estates)).toEqual([])
        expect((await ownerDb().select().from(units)).length).toBe(6)
    })

    it('an estate context only exposes that estate, even when querying by the other estate\'s ids', async () => {
        const { a, b, residentB } = await twoEstates()
        await withDbContext({ estateId: a.estate.id }, async (tx) => {
            const visible = await tx.select({ estateId: units.estateId }).from(units)
            expect(visible.length).toBe(3)
            expect(visible.every(u => u.estateId === a.estate.id)).toBe(true)
            expect(await tx.select().from(occupancies).where(eq(occupancies.id, residentB.id))).toEqual([])
            expect(await tx.select().from(vehicles)).toEqual([])
            expect(await tx.select().from(estates).where(eq(estates.id, b.estate.id))).toEqual([])
        })
    })

    it('cross-estate writes are blocked by the database', async () => {
        const { a, b, residentB } = await twoEstates()
        await expect(withDbContext({ estateId: a.estate.id }, tx =>
            tx.insert(zones).values({ estateId: b.estate.id, name: 'Sneaky Street' }))).rejects.toSatisfy(isRlsViolation)
        const updated = await withDbContext({ estateId: a.estate.id }, tx =>
            tx.update(occupancies).set({ name: 'Hacked' }).where(eq(occupancies.id, residentB.id)).returning())
        expect(updated).toEqual([])
        const deleted = await withDbContext({ estateId: a.estate.id }, tx =>
            tx.delete(vehicles).where(eq(vehicles.estateId, b.estate.id)).returning())
        expect(deleted).toEqual([])
        // Moving a row into another estate is refused too
        await expect(withDbContext({ estateId: a.estate.id }, tx =>
            tx.update(units).set({ estateId: b.estate.id }).where(eq(units.estateId, a.estate.id)))).rejects.toSatisfy(isRlsViolation)
        const [still] = await ownerDb().select().from(occupancies).where(eq(occupancies.id, residentB.id))
        expect(still.name).toBe('Bola B')
    })

    it('a user context shows only that user\'s own memberships and occupancies', async () => {
        const { a, b, residentB } = await twoEstates()
        const rows = await withDbContext({ userId: a.admin.userId }, tx => tx.select().from(memberships))
        expect(rows.map(r => r.estateId)).toEqual([a.estate.id])
        const occ = await withDbContext({ userId: residentB.userId! }, tx => tx.select().from(occupancies))
        expect(occ.map(o => o.id)).toEqual([residentB.id])
        expect(b).toBeTruthy()
    })

    it('context does not leak between transactions on pooled connections', async () => {
        const { a } = await twoEstates()
        await withDbContext({ estateId: a.estate.id }, tx => tx.select().from(units))
        const results = await Promise.all(Array.from({ length: 12 }, () => getDb().select().from(units)))
        expect(results.every(r => r.length === 0)).toBe(true)
        const [{ setting }] = (await getDb().execute<{ setting: string }>(sql`select coalesce(current_setting('app.estate_id', true), '') as setting`)).rows
        expect(setting).toBe('')
    })

    it('the app role cannot switch off row-level security', async () => {
        // With row_security off, Postgres raises instead of returning other estates' rows
        await twoEstates()
        await expect(getDb().transaction(async (tx) => {
            await tx.execute(sql`set local row_security = off`)
            return tx.select().from(units)
        })).rejects.toSatisfy(isRlsViolation)
    })
})

describe('cross-estate attempts through the domain API', () => {
    it('estate A admin cannot read or change estate B', async () => {
        const { a, b, residentB } = await twoEstates()
        const A = a.admin
        const B = b.estate.id
        const forbidden = /permission/
        await expect(getEstateForStaff(A, B)).rejects.toThrow(forbidden)
        await expect(listZonesWithUnits(A, B)).rejects.toThrow(forbidden)
        await expect(listResidents(A, B)).rejects.toThrow(forbidden)
        await expect(listPendingResidents(A, B)).rejects.toThrow(forbidden)
        await expect(countResidents(A, B)).rejects.toThrow(forbidden)
        await expect(getUnitDetail(A, B, b.units[0].id)).rejects.toThrow(forbidden)
        await expect(createZone(A, B, { name: 'X' })).rejects.toThrow(forbidden)
        await expect(addUnits(A, B, { zoneId: b.zone.id, labels: '9' })).rejects.toThrow(forbidden)
        await expect(setUnitActive(A, B, b.units[1].id, false)).rejects.toThrow(forbidden)
        await expect(addResident(A, B, { unitId: b.units[1].id, name: 'Intruder', phone: nextPhone(), relation: 'owner' })).rejects.toThrow(forbidden)
        await expect(moveOutResident(A, B, residentB.id)).rejects.toThrow(forbidden)
        await expect(setPrimaryContact(A, B, residentB.id)).rejects.toThrow(forbidden)
        await expect(updateEstateDetails(A, B, { name: 'Renamed', gateCount: 1 })).rejects.toThrow(forbidden)
        await expect(regenerateJoinCode(A, B)).rejects.toThrow(forbidden)
        await expect(addVehicle(A, B, { unitId: b.units[1].id, plate: 'AAA111AA' })).rejects.toThrow(forbidden)
        await expect(listStaff(A, B)).rejects.toThrow(forbidden)
        await expect(addStaff(A, B, { name: 'Mole', phone: nextPhone(), role: 'estate_admin' })).rejects.toThrow(forbidden)
        await expect(listAuditLog(A, B)).rejects.toThrow(forbidden)
    })

    it('using estate A\'s id with estate B\'s object ids finds nothing', async () => {
        const { a, b, residentB } = await twoEstates()
        await expect(getUnitDetail(a.admin, a.estate.id, b.units[0].id)).rejects.toThrow('not found')
        await expect(moveOutResident(a.admin, a.estate.id, residentB.id)).rejects.toThrow('not found')
        await expect(approveResident(a.admin, a.estate.id, residentB.id)).rejects.toThrow('not found')
        await expect(addUnits(a.admin, a.estate.id, { zoneId: b.zone.id, labels: '9' })).rejects.toThrow('not found')
        await expect(addResident(a.admin, a.estate.id, { unitId: b.units[1].id, name: 'Wrong Unit', phone: nextPhone(), relation: 'owner' })).rejects.toThrow('not found')
        await expect(addVehicle(a.admin, a.estate.id, { unitId: b.units[1].id, plate: 'AAA111AA' })).rejects.toThrow('not found')
        const [row] = await ownerDb().select().from(occupancies).where(eq(occupancies.id, residentB.id))
        expect(row.status).toBe('active')
    })
})

describe('roles', () => {
    it('matches the product role table', () => {
        expect(ROLE_CAPABILITIES.guard).not.toContain('finance.read')
        expect(ROLE_CAPABILITIES.guard).not.toContain('residents.read')
        expect(ROLE_CAPABILITIES.guard).toContain('gate.operate')
        expect(ROLE_CAPABILITIES.finance_officer).toEqual(expect.arrayContaining(['finance.read', 'finance.manage', 'reports.read']))
        expect(ROLE_CAPABILITIES.finance_officer).not.toContain('gate.operate')
        expect(ROLE_CAPABILITIES.resident).toEqual([])
        expect(ROLE_CAPABILITIES.support.some(c => c.endsWith('.manage') || c === 'gate.operate')).toBe(false)
    })

    it('guard sees the estate layout but not residents or finance', async () => {
        const { estate, admin, units: u } = await createTestEstate()
        await addResident(admin, estate.id, { unitId: u[0].id, name: 'Ada Obi', phone: nextPhone(), relation: 'owner' })
        const guardPhone = nextPhone()
        await addStaff(admin, estate.id, { name: 'Gate Guard', phone: guardPhone, role: 'guard' })
        const [m] = await ownerDb().select().from(memberships).where(eq(memberships.role, 'guard'))
        const guard = actorFor(m.userId)
        const access = await accessOf(guard, estate.id)
        expect(access.capabilities.has('finance.read')).toBe(false) // a guard cannot see invoices
        expect((await listZonesWithUnits(guard, estate.id))[0].units).toHaveLength(5)
        await expect(listResidents(guard, estate.id)).rejects.toThrow('permission')
        await expect(getUnitDetail(guard, estate.id, u[0].id)).rejects.toThrow('permission')
        await expect(addResident(guard, estate.id, { unitId: u[1].id, name: 'X Y', phone: nextPhone(), relation: 'owner' })).rejects.toThrow('permission')
    })

    it('finance officer reads residents but cannot manage them, staff or the estate', async () => {
        const { estate, admin } = await createTestEstate()
        await addStaff(admin, estate.id, { name: 'Fin Officer', phone: nextPhone(), role: 'finance_officer' })
        const [m] = await ownerDb().select().from(memberships).where(eq(memberships.role, 'finance_officer'))
        const fin = actorFor(m.userId)
        expect((await accessOf(fin, estate.id)).capabilities.has('finance.manage')).toBe(true)
        await expect(listResidents(fin, estate.id)).resolves.toEqual([])
        await expect(listPendingResidents(fin, estate.id)).rejects.toThrow('permission')
        await expect(addStaff(fin, estate.id, { name: 'Me Again', phone: nextPhone(), role: 'estate_admin' })).rejects.toThrow('permission')
        await expect(updateEstateDetails(fin, estate.id, { name: 'X Estate', gateCount: 1 })).rejects.toThrow('permission')
    })

    it('a resident cannot see other residents or anyone\'s payment status', async () => {
        const { estate, admin, units: u } = await createTestEstate()
        const me = await addResident(admin, estate.id, { unitId: u[0].id, name: 'Me Resident', phone: nextPhone(), relation: 'owner' })
        await addResident(admin, estate.id, { unitId: u[1].id, name: 'Neighbour', phone: nextPhone(), relation: 'owner' })
        const resident = actorFor(me.userId!)
        const access = await accessOf(resident, estate.id)
        expect(access.roles).toEqual(['resident'])
        expect(access.capabilities.has('finance.read')).toBe(false)
        expect(access.capabilities.has('residents.read')).toBe(false)
        await expect(listResidents(resident, estate.id)).rejects.toThrow('permission')
        await expect(getUnitDetail(resident, estate.id, u[1].id)).rejects.toThrow('permission')
        await expect(getEstateForStaff(resident, estate.id)).rejects.toThrow('permission')
    })

    it('staff roles can be added and removed, but never the last estate admin', async () => {
        const { estate, admin } = await createTestEstate()
        const [adminMembership] = await ownerDb().select().from(memberships).where(eq(memberships.userId, admin.userId))
        await expect(removeStaff(admin, estate.id, adminMembership.id)).rejects.toThrow('at least one estate admin')
        const second = await addStaff(admin, estate.id, { name: 'Vice Chair', phone: nextPhone(), role: 'estate_admin' })
        await removeStaff(admin, estate.id, adminMembership.id)
        expect((await accessOf(admin, estate.id)).staffRoles).toEqual([])
        expect(second.isActive).toBe(true)
        const actions = (await ownerDb().select().from(auditLogs).where(eq(auditLogs.estateId, estate.id))).map(r => r.action)
        expect(actions).toEqual(expect.arrayContaining(['staff.role_added', 'staff.role_removed']))
    })
})

describe('support access for platform admins', () => {
    it('platform admins cannot see estate data without a grant', async () => {
        const { platform, estate } = await createTestEstate()
        await expect(getEstateForStaff(platform, estate.id)).rejects.toThrow('permission')
        await expect(listResidents(platform, estate.id)).rejects.toThrow('permission')
        const overview = await listAllEstates(platform)
        expect(Object.keys(overview[0]).sort()).toEqual(['createdAt', 'district', 'id', 'name', 'residentCount', 'status', 'unitCount'])
    })

    it('a reasoned grant gives read-only access and is logged for the estate admin', async () => {
        const { platform, estate, admin, units: u } = await createTestEstate()
        await addResident(admin, estate.id, { unitId: u[0].id, name: 'Ada Obi', phone: nextPhone(), relation: 'owner' })
        await expect(grantSupportAccess(platform, estate.id, 'help')).rejects.toThrow('Explain why')
        const nobody = await createUser()
        await expect(grantSupportAccess(nobody, estate.id, 'Ticket #123: levy totals look wrong')).rejects.toThrow('permission')

        await grantSupportAccess(platform, estate.id, 'Ticket #123: levy totals look wrong')
        const access = await accessOf(platform, estate.id)
        expect(access.viaSupport).toBe(true)
        expect((await listResidents(platform, estate.id)).map(r => r.name)).toEqual(['Ada Obi'])
        await expect(addResident(platform, estate.id, { unitId: u[1].id, name: 'Support Edit', phone: nextPhone(), relation: 'owner' })).rejects.toThrow('permission')
        await expect(updateEstateDetails(platform, estate.id, { name: 'Changed', gateCount: 1 })).rejects.toThrow('permission')

        const log = await listSupportGrants(admin, estate.id)
        expect(log).toEqual([expect.objectContaining({ reason: 'Ticket #123: levy totals look wrong', name: 'Teeco Ops' })])
        expect((await listAuditLog(admin, estate.id, { action: 'support.granted' }))).toHaveLength(1)

        await revokeSupportAccess(platform, estate.id)
        await expect(listResidents(platform, estate.id)).rejects.toThrow('permission')
    })

    it('expired grants stop working', async () => {
        const { platform, estate } = await createTestEstate()
        await grantSupportAccess(platform, estate.id, 'Checking onboarding progress')
        await ownerDb().update(supportAccessGrants).set({ expiresAt: new Date(Date.now() - 1000) })
        await expect(getEstateForStaff(platform, estate.id)).rejects.toThrow('permission')
    })
})

describe('self-registration stays inside the chosen estate', () => {
    it('a resident request for estate B cannot target estate A\'s units', async () => {
        const { a, b } = await twoEstates()
        const user = await createUser()
        await expect(registerAsResident(user, { joinCode: b.estate.joinCode, unitId: a.units[0].id, name: 'Wrong Estate', relation: 'owner' })).rejects.toThrow('Choose a house')
    })
})
