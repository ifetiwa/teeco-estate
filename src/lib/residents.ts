import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import { type Queryable, getDb, withDbContext } from '@/db'
import { estates, occupancies, occupantRelation, unitHelpers, units, users, vehicles, zones } from '@/db/schema'
import { type Actor, getEstateAccess, requireCapability } from '@/lib/access'
import { recordAudit } from '@/lib/audit'
import { ensureUserByPhone, findEstateByJoinCode } from '@/lib/estates'
import { AppError, ForbiddenError, NotFoundError, isUniqueViolation } from '@/lib/errors'
import { normalizeNigerianPhone } from '@/lib/phone'

export type Occupancy = typeof occupancies.$inferSelect

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date').optional().or(z.literal('')).transform(v => v || undefined)
const optionalEmail = z.union([z.literal(''), z.email('Enter a valid email')]).optional().transform(v => v || undefined)
const nigerianPhone = z.string().refine(v => normalizeNigerianPhone(v), 'Enter a valid Nigerian phone number').transform(v => normalizeNigerianPhone(v)!)

export const addResidentSchema = z.object({
    unitId: z.uuid(),
    name: z.string().trim().min(2, 'Enter the resident\'s name').max(120),
    phone: nigerianPhone,
    email: optionalEmail,
    relation: z.enum(occupantRelation.enumValues),
    isPrimary: z.coerce.boolean().default(false),
    moveInDate: isoDate,
})

function duplicateOccupancyError (e: unknown): never {
    if (isUniqueViolation(e, 'occupancies_open_phone_per_unit')) throw new AppError('This phone number is already registered at this unit.')
    throw e
}

async function unitInEstate (tx: Queryable, estateId: string, unitId: string) {
    const [unit] = await tx.select({ id: units.id, isActive: units.isActive }).from(units).where(and(eq(units.id, unitId), eq(units.estateId, estateId)))
    if (!unit) throw new NotFoundError('Unit')
    if (!unit.isActive) throw new AppError('This unit is not active.')
    return unit
}

async function unitHasPrimary (tx: Queryable, unitId: string, excludeId?: string): Promise<boolean> {
    const rows = await tx.select({ id: occupancies.id }).from(occupancies)
        .where(and(eq(occupancies.unitId, unitId), eq(occupancies.status, 'active'), eq(occupancies.isPrimary, true),
            excludeId ? ne(occupancies.id, excludeId) : undefined))
    return rows.length > 0
}

async function clearPrimary (tx: Queryable, unitId: string) {
    await tx.update(occupancies).set({ isPrimary: false }).where(and(eq(occupancies.unitId, unitId), eq(occupancies.isPrimary, true)))
}

/** Estate admin adds a resident directly; they are active immediately and can sign in with their phone. */
export async function addResident (actor: Actor, estateId: string, input: z.input<typeof addResidentSchema>): Promise<Occupancy> {
    const data = addResidentSchema.parse(input)
    // Authorise before touching the (global) users table
    await withDbContext({ estateId, userId: actor.userId }, tx => requireCapability(tx, actor, estateId, 'residents.manage'))
    const userId = await ensureUserByPhone(data.phone, data.name)
    try {
        return await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
            await requireCapability(tx, actor, estateId, 'residents.manage')
            await unitInEstate(tx, estateId, data.unitId)
            const makePrimary = data.isPrimary || !(await unitHasPrimary(tx, data.unitId))
            if (makePrimary) await clearPrimary(tx, data.unitId)
            const [row] = await tx.insert(occupancies).values({
                estateId,
                unitId: data.unitId,
                userId,
                name: data.name,
                phone: data.phone,
                email: data.email,
                relation: data.relation,
                isPrimary: makePrimary,
                status: 'active',
                moveInDate: data.moveInDate,
                reviewedBy: actor.userId,
                reviewedAt: new Date(),
            }).returning()
            return row
        })
    } catch (e) {
        duplicateOccupancyError(e)
    }
}

export const registerSchema = z.object({
    joinCode: z.string().trim().min(1, 'Enter the estate join code'),
    unitId: z.uuid('Choose your house or flat'),
    name: z.string().trim().min(2, 'Enter your full name').max(120),
    email: optionalEmail,
    relation: z.enum(occupantRelation.enumValues),
    moveInDate: isoDate,
})

/** A signed-in user asks to join an estate; the request waits in the admin's approval queue. */
export async function registerAsResident (actor: Actor, input: z.input<typeof registerSchema>): Promise<Occupancy> {
    const data = registerSchema.parse(input)
    const { estate, units: estateUnits } = await findEstateByJoinCode(data.joinCode)
    if (estate.status === 'suspended') throw new AppError('This estate is not accepting registrations right now.')
    if (!estateUnits.some(u => u.unitId === data.unitId)) throw new AppError('Choose a house or flat from this estate.')
    const [user] = await getDb().select().from(users).where(eq(users.id, actor.userId))
    if (!user) throw new NotFoundError('User')
    if (!user.name) await getDb().update(users).set({ name: data.name }).where(eq(users.id, user.id))
    try {
        return await withDbContext({ estateId: estate.id, userId: actor.userId }, async (tx) => {
            const [row] = await tx.insert(occupancies).values({
                estateId: estate.id,
                unitId: data.unitId,
                userId: user.id,
                name: data.name,
                phone: user.phone,
                email: data.email,
                relation: data.relation,
                status: 'pending',
                moveInDate: data.moveInDate,
            }).returning()
            return row
        })
    } catch (e) {
        duplicateOccupancyError(e)
    }
}

async function getOccupancyInEstate (tx: Queryable, estateId: string, occupancyId: string): Promise<Occupancy> {
    const [row] = await tx.select().from(occupancies).where(and(eq(occupancies.id, occupancyId), eq(occupancies.estateId, estateId)))
    if (!row) throw new NotFoundError('Resident')
    return row
}

export async function approveResident (actor: Actor, estateId: string, occupancyId: string): Promise<Occupancy> {
    try {
        return await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
            await requireCapability(tx, actor, estateId, 'residents.manage')
            const occ = await getOccupancyInEstate(tx, estateId, occupancyId)
            if (occ.status !== 'pending') throw new AppError('This request has already been handled.')
            const makePrimary = !(await unitHasPrimary(tx, occ.unitId))
            const [row] = await tx.update(occupancies)
                .set({ status: 'active', isPrimary: makePrimary, reviewedBy: actor.userId, reviewedAt: new Date() })
                .where(eq(occupancies.id, occupancyId)).returning()
            await recordAudit(tx, { estateId, actorUserId: actor.userId, action: 'resident.approved', entityType: 'occupancy', entityId: occupancyId })
            return row
        })
    } catch (e) {
        duplicateOccupancyError(e)
    }
}

export async function rejectResident (actor: Actor, estateId: string, occupancyId: string, reason: string): Promise<Occupancy> {
    const trimmed = reason.trim()
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'residents.manage')
        if (trimmed.length < 3) throw new AppError('Give a short reason so the person knows what to do next.')
        const occ = await getOccupancyInEstate(tx, estateId, occupancyId)
        if (occ.status !== 'pending') throw new AppError('This request has already been handled.')
        const [row] = await tx.update(occupancies)
            .set({ status: 'rejected', rejectionReason: trimmed.slice(0, 300), reviewedBy: actor.userId, reviewedAt: new Date() })
            .where(eq(occupancies.id, occupancyId)).returning()
        await recordAudit(tx, { estateId, actorUserId: actor.userId, action: 'resident.rejected', entityType: 'occupancy', entityId: occupancyId, details: { reason: row.rejectionReason } })
        return row
    })
}

export async function setPrimaryContact (actor: Actor, estateId: string, occupancyId: string): Promise<void> {
    await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'residents.manage')
        const occ = await getOccupancyInEstate(tx, estateId, occupancyId)
        if (occ.status !== 'active') throw new AppError('Only a current resident can be the primary contact.')
        await clearPrimary(tx, occ.unitId)
        await tx.update(occupancies).set({ isPrimary: true }).where(eq(occupancies.id, occupancyId))
    })
}

/**
 * Moves a resident out: their estate access ends (access is derived from active occupancies) and the
 * record is kept as history. When the unit becomes empty its vehicles and helpers are deactivated too.
 */
export async function moveOutResident (actor: Actor, estateId: string, occupancyId: string, moveOutDate?: string): Promise<Occupancy> {
    const date = moveOutDate || new Date().toISOString().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError('Use a valid move-out date.')
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'residents.manage')
        const occ = await getOccupancyInEstate(tx, estateId, occupancyId)
        if (occ.status !== 'active') throw new AppError('Only a current resident can be moved out.')
        if (occ.moveInDate && date < occ.moveInDate) throw new AppError('Move-out date cannot be before the move-in date.')
        const [row] = await tx.update(occupancies)
            .set({ status: 'moved_out', moveOutDate: date, isPrimary: false })
            .where(eq(occupancies.id, occupancyId)).returning()
        const remaining = await tx.select({ id: occupancies.id, isPrimary: occupancies.isPrimary }).from(occupancies)
            .where(and(eq(occupancies.unitId, occ.unitId), eq(occupancies.status, 'active')))
            .orderBy(asc(occupancies.createdAt))
        if (remaining.length === 0) {
            await tx.update(vehicles).set({ isActive: false }).where(eq(vehicles.unitId, occ.unitId))
            await tx.update(unitHelpers).set({ isActive: false }).where(eq(unitHelpers.unitId, occ.unitId))
        } else if (occ.isPrimary && !remaining.some(r => r.isPrimary)) {
            await tx.update(occupancies).set({ isPrimary: true }).where(eq(occupancies.id, remaining[0].id))
        }
        await recordAudit(tx, { estateId, actorUserId: actor.userId, action: 'resident.moved_out', entityType: 'occupancy', entityId: occupancyId, details: { moveOutDate: date } })
        return row
    })
}

const residentColumns = {
    id: occupancies.id,
    name: occupancies.name,
    phone: occupancies.phone,
    email: occupancies.email,
    relation: occupancies.relation,
    isPrimary: occupancies.isPrimary,
    status: occupancies.status,
    moveInDate: occupancies.moveInDate,
    moveOutDate: occupancies.moveOutDate,
    createdAt: occupancies.createdAt,
    unitId: units.id,
    unitLabel: units.label,
    zoneName: zones.name,
}

export async function listPendingResidents (actor: Actor, estateId: string) {
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'residents.manage')
        return tx.select(residentColumns).from(occupancies)
            .innerJoin(units, eq(units.id, occupancies.unitId)).innerJoin(zones, eq(zones.id, units.zoneId))
            .where(and(eq(occupancies.estateId, estateId), eq(occupancies.status, 'pending')))
            .orderBy(asc(occupancies.createdAt))
    })
}

export async function listResidents (actor: Actor, estateId: string, opts: { search?: string, includePast?: boolean } = {}) {
    const search = opts.search?.trim()
    const phoneSearch = search ? normalizeNigerianPhone(search) : null
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'residents.read')
        return tx.select(residentColumns).from(occupancies)
            .innerJoin(units, eq(units.id, occupancies.unitId)).innerJoin(zones, eq(zones.id, units.zoneId))
            .where(and(
                eq(occupancies.estateId, estateId),
                inArray(occupancies.status, opts.includePast ? ['active', 'moved_out'] : ['active']),
                search ? or(ilike(occupancies.name, `%${search}%`), ilike(units.label, `%${search}%`), ilike(zones.name, `%${search}%`),
                    phoneSearch ? eq(occupancies.phone, phoneSearch) : undefined) : undefined,
            ))
            .orderBy(asc(zones.name), asc(units.label), desc(occupancies.isPrimary), asc(occupancies.name))
    })
}

/** The signed-in user's own homes and requests, across estates. */
export async function listMyOccupancies (actor: Actor) {
    const mine = await withDbContext({ userId: actor.userId }, tx =>
        tx.select({ occupancy: occupancies, estateName: estates.name }).from(occupancies)
            .innerJoin(estates, eq(estates.id, occupancies.estateId))
            .where(eq(occupancies.userId, actor.userId))
            .orderBy(desc(occupancies.createdAt)))
    // Unit and street names live in each estate's context
    const byEstate = new Map<string, string[]>()
    for (const m of mine) byEstate.set(m.occupancy.estateId, [...(byEstate.get(m.occupancy.estateId) ?? []), m.occupancy.unitId])
    const unitInfo = new Map<string, { unitLabel: string, zoneName: string }>()
    for (const [estateId, unitIds] of byEstate) {
        const rows = await withDbContext({ estateId, userId: actor.userId }, tx =>
            tx.select({ id: units.id, unitLabel: units.label, zoneName: zones.name }).from(units)
                .innerJoin(zones, eq(zones.id, units.zoneId)).where(inArray(units.id, unitIds)))
        for (const r of rows) unitInfo.set(r.id, r)
    }
    return mine.map(({ occupancy: o, estateName }) => ({
        id: o.id,
        estateId: o.estateId,
        estateName,
        unitId: o.unitId,
        unitLabel: unitInfo.get(o.unitId)?.unitLabel ?? '',
        zoneName: unitInfo.get(o.unitId)?.zoneName ?? '',
        name: o.name,
        relation: o.relation,
        isPrimary: o.isPrimary,
        status: o.status,
        rejectionReason: o.rejectionReason,
        createdAt: o.createdAt,
    }))
}

/** A resident's own home: only for the occupant themself, while their occupancy is active. */
export async function getMyHome (actor: Actor, occupancyId: string) {
    const [own] = await withDbContext({ userId: actor.userId }, tx =>
        tx.select().from(occupancies)
            .where(and(eq(occupancies.id, occupancyId), eq(occupancies.userId, actor.userId), eq(occupancies.status, 'active'))))
    if (!own) throw new NotFoundError('Home')
    return withDbContext({ estateId: own.estateId, userId: actor.userId }, async (tx) => {
        const [row] = await tx.select({ unit: units, zone: zones, estateName: estates.name }).from(units)
            .innerJoin(zones, eq(zones.id, units.zoneId)).innerJoin(estates, eq(estates.id, units.estateId))
            .where(eq(units.id, own.unitId))
        const [household, veh, helpers] = await Promise.all([
            tx.select({ id: occupancies.id, name: occupancies.name, relation: occupancies.relation, isPrimary: occupancies.isPrimary })
                .from(occupancies).where(and(eq(occupancies.unitId, own.unitId), eq(occupancies.status, 'active'))).orderBy(asc(occupancies.name)),
            tx.select().from(vehicles).where(and(eq(vehicles.unitId, own.unitId), eq(vehicles.isActive, true))).orderBy(asc(vehicles.createdAt)),
            tx.select().from(unitHelpers).where(and(eq(unitHelpers.unitId, own.unitId), eq(unitHelpers.isActive, true))).orderBy(asc(unitHelpers.createdAt)),
        ])
        return { occupancy: own, ...row, household, vehicles: veh, helpers }
    })
}

// ---------- Vehicles and domestic staff ----------

/** Estate admins, or a current resident of the unit, may manage its vehicles and helpers. */
async function requireUnitManager (tx: Queryable, actor: Actor, estateId: string, unitId: string): Promise<void> {
    const access = await getEstateAccess(tx, actor, estateId)
    if (access.capabilities.has('residents.manage')) {
        await unitInEstate(tx, estateId, unitId)
        return
    }
    if (!access.residentUnitIds.includes(unitId)) throw new ForbiddenError()
}

export function normalizePlate (raw: string): string {
    return raw.toUpperCase().replace(/[\s\-.]/g, '')
}

export const vehicleSchema = z.object({
    unitId: z.uuid(),
    plate: z.string().transform(normalizePlate).refine(v => /^[A-Z0-9]{5,10}$/.test(v), 'Enter a valid plate number, e.g. ABC-123DE'),
    make: z.string().trim().max(60).default(''),
    colour: z.string().trim().max(30).default(''),
})

export async function addVehicle (actor: Actor, estateId: string, input: z.input<typeof vehicleSchema>) {
    const data = vehicleSchema.parse(input)
    try {
        return await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
            await requireUnitManager(tx, actor, estateId, data.unitId)
            const [row] = await tx.insert(vehicles).values({ estateId, ...data }).returning()
            return row
        })
    } catch (e) {
        if (isUniqueViolation(e)) throw new AppError('This plate number is already registered in the estate.')
        throw e
    }
}

export async function removeVehicle (actor: Actor, estateId: string, vehicleId: string) {
    await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        const [v] = await tx.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.estateId, estateId)))
        if (!v) throw new NotFoundError('Vehicle')
        await requireUnitManager(tx, actor, estateId, v.unitId)
        await tx.update(vehicles).set({ isActive: false }).where(eq(vehicles.id, vehicleId))
    })
}

export const helperSchema = z.object({
    unitId: z.uuid(),
    name: z.string().trim().min(2, 'Enter a name').max(120),
    phone: z.string().optional().transform(v => v?.trim() || undefined)
        .refine(v => !v || normalizeNigerianPhone(v), 'Enter a valid Nigerian phone number')
        .transform(v => (v ? normalizeNigerianPhone(v)! : undefined)),
    role: z.enum(unitHelpers.role.enumValues).default('other'),
})

export async function addHelper (actor: Actor, estateId: string, input: z.input<typeof helperSchema>) {
    const data = helperSchema.parse(input)
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireUnitManager(tx, actor, estateId, data.unitId)
        const [row] = await tx.insert(unitHelpers).values({ estateId, ...data }).returning()
        return row
    })
}

export async function removeHelper (actor: Actor, estateId: string, helperId: string) {
    await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        const [h] = await tx.select().from(unitHelpers).where(and(eq(unitHelpers.id, helperId), eq(unitHelpers.estateId, estateId)))
        if (!h) throw new NotFoundError('Helper')
        await requireUnitManager(tx, actor, estateId, h.unitId)
        await tx.update(unitHelpers).set({ isActive: false }).where(eq(unitHelpers.id, helperId))
    })
}

export async function countResidents (actor: Actor, estateId: string) {
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'residents.read')
        const [row] = await tx.select({
            active: sql<number>`count(*) filter (where ${occupancies.status} = 'active')::int`,
            pending: sql<number>`count(*) filter (where ${occupancies.status} = 'pending')::int`,
        }).from(occupancies).where(eq(occupancies.estateId, estateId))
        return row
    })
}
