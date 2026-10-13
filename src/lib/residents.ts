import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import { getDb, type DB } from '@/db'
import { estates, occupancies, occupantRelation, unitHelpers, units, users, vehicles, zones } from '@/db/schema'
import { type Actor, getEstateAccess, requireStaffRole } from '@/lib/access'
import { ensureUserByPhone, findEstateByJoinCode } from '@/lib/estates'
import { AppError, ForbiddenError, NotFoundError, isUniqueViolation } from '@/lib/errors'
import { normalizeNigerianPhone } from '@/lib/phone'

export type Occupancy = typeof occupancies.$inferSelect
type Tx = Parameters<Parameters<DB['transaction']>[0]>[0]

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

async function unitInEstate (db: DB | Tx, estateId: string, unitId: string) {
    const [unit] = await db.select({ id: units.id, isActive: units.isActive }).from(units).where(and(eq(units.id, unitId), eq(units.estateId, estateId)))
    if (!unit) throw new NotFoundError('Unit')
    if (!unit.isActive) throw new AppError('This unit is not active.')
    return unit
}

async function unitHasPrimary (db: DB | Tx, unitId: string, excludeId?: string): Promise<boolean> {
    const rows = await db.select({ id: occupancies.id }).from(occupancies)
        .where(and(eq(occupancies.unitId, unitId), eq(occupancies.status, 'active'), eq(occupancies.isPrimary, true),
            excludeId ? ne(occupancies.id, excludeId) : undefined))
    return rows.length > 0
}

async function clearPrimary (db: DB | Tx, unitId: string) {
    await db.update(occupancies).set({ isPrimary: false }).where(and(eq(occupancies.unitId, unitId), eq(occupancies.isPrimary, true)))
}

/** Estate admin adds a resident directly; they are active immediately and can sign in with their phone. */
export async function addResident (actor: Actor, estateId: string, input: z.input<typeof addResidentSchema>): Promise<Occupancy> {
    await requireStaffRole(actor, estateId, ['estate_admin'])
    const data = addResidentSchema.parse(input)
    const userId = await ensureUserByPhone(data.phone, data.name)
    const db = getDb()
    try {
        return await db.transaction(async (tx) => {
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
    const db = getDb()
    const [user] = await db.select().from(users).where(eq(users.id, actor.userId))
    if (!user) throw new NotFoundError('User')
    if (!user.name) await db.update(users).set({ name: data.name }).where(eq(users.id, user.id))
    try {
        const [row] = await db.insert(occupancies).values({
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
    } catch (e) {
        duplicateOccupancyError(e)
    }
}

async function getOccupancyInEstate (db: DB | Tx, estateId: string, occupancyId: string): Promise<Occupancy> {
    const [row] = await db.select().from(occupancies).where(and(eq(occupancies.id, occupancyId), eq(occupancies.estateId, estateId)))
    if (!row) throw new NotFoundError('Resident')
    return row
}

export async function approveResident (actor: Actor, estateId: string, occupancyId: string): Promise<Occupancy> {
    await requireStaffRole(actor, estateId, ['estate_admin'])
    const db = getDb()
    try {
        return await db.transaction(async (tx) => {
            const occ = await getOccupancyInEstate(tx, estateId, occupancyId)
            if (occ.status !== 'pending') throw new AppError('This request has already been handled.')
            const makePrimary = !(await unitHasPrimary(tx, occ.unitId))
            const [row] = await tx.update(occupancies)
                .set({ status: 'active', isPrimary: makePrimary, reviewedBy: actor.userId, reviewedAt: new Date() })
                .where(eq(occupancies.id, occupancyId)).returning()
            return row
        })
    } catch (e) {
        duplicateOccupancyError(e)
    }
}

export async function rejectResident (actor: Actor, estateId: string, occupancyId: string, reason: string): Promise<Occupancy> {
    await requireStaffRole(actor, estateId, ['estate_admin'])
    const trimmed = reason.trim()
    if (trimmed.length < 3) throw new AppError('Give a short reason so the person knows what to do next.')
    const db = getDb()
    const occ = await getOccupancyInEstate(db, estateId, occupancyId)
    if (occ.status !== 'pending') throw new AppError('This request has already been handled.')
    const [row] = await db.update(occupancies)
        .set({ status: 'rejected', rejectionReason: trimmed.slice(0, 300), reviewedBy: actor.userId, reviewedAt: new Date() })
        .where(eq(occupancies.id, occupancyId)).returning()
    return row
}

export async function setPrimaryContact (actor: Actor, estateId: string, occupancyId: string): Promise<void> {
    await requireStaffRole(actor, estateId, ['estate_admin'])
    await getDb().transaction(async (tx) => {
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
    await requireStaffRole(actor, estateId, ['estate_admin'])
    const date = moveOutDate || new Date().toISOString().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError('Use a valid move-out date.')
    return getDb().transaction(async (tx) => {
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
    await requireStaffRole(actor, estateId, ['estate_admin'])
    return getDb().select(residentColumns).from(occupancies)
        .innerJoin(units, eq(units.id, occupancies.unitId)).innerJoin(zones, eq(zones.id, units.zoneId))
        .where(and(eq(occupancies.estateId, estateId), eq(occupancies.status, 'pending')))
        .orderBy(asc(occupancies.createdAt))
}

export async function listResidents (actor: Actor, estateId: string, opts: { search?: string, includePast?: boolean } = {}) {
    await requireStaffRole(actor, estateId, ['estate_admin', 'finance_officer'])
    const search = opts.search?.trim()
    const phoneSearch = search ? normalizeNigerianPhone(search) : null
    return getDb().select(residentColumns).from(occupancies)
        .innerJoin(units, eq(units.id, occupancies.unitId)).innerJoin(zones, eq(zones.id, units.zoneId))
        .where(and(
            eq(occupancies.estateId, estateId),
            inArray(occupancies.status, opts.includePast ? ['active', 'moved_out'] : ['active']),
            search ? or(ilike(occupancies.name, `%${search}%`), ilike(units.label, `%${search}%`), ilike(zones.name, `%${search}%`),
                phoneSearch ? eq(occupancies.phone, phoneSearch) : undefined) : undefined,
        ))
        .orderBy(asc(zones.name), asc(units.label), desc(occupancies.isPrimary), asc(occupancies.name))
}

/** The signed-in user's own homes and requests, across estates. */
export async function listMyOccupancies (actor: Actor) {
    return getDb().select({ ...residentColumns, estateId: estates.id, estateName: estates.name, rejectionReason: occupancies.rejectionReason })
        .from(occupancies)
        .innerJoin(units, eq(units.id, occupancies.unitId)).innerJoin(zones, eq(zones.id, units.zoneId))
        .innerJoin(estates, eq(estates.id, occupancies.estateId))
        .where(eq(occupancies.userId, actor.userId))
        .orderBy(desc(occupancies.createdAt))
}

// ---------- Vehicles and domestic staff ----------

/** Estate admins, or a current resident of the unit, may manage its vehicles and helpers. */
async function requireUnitManager (actor: Actor, estateId: string, unitId: string): Promise<void> {
    const access = await getEstateAccess(actor, estateId)
    if (access.staffRoles.includes('estate_admin')) {
        await unitInEstate(getDb(), estateId, unitId)
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
    await requireUnitManager(actor, estateId, data.unitId)
    try {
        const [row] = await getDb().insert(vehicles).values({ estateId, ...data }).returning()
        return row
    } catch (e) {
        if (isUniqueViolation(e)) throw new AppError('This plate number is already registered in the estate.')
        throw e
    }
}

export async function removeVehicle (actor: Actor, estateId: string, vehicleId: string) {
    const db = getDb()
    const [v] = await db.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.estateId, estateId)))
    if (!v) throw new NotFoundError('Vehicle')
    await requireUnitManager(actor, estateId, v.unitId)
    await db.update(vehicles).set({ isActive: false }).where(eq(vehicles.id, vehicleId))
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
    await requireUnitManager(actor, estateId, data.unitId)
    const [row] = await getDb().insert(unitHelpers).values({ estateId, ...data }).returning()
    return row
}

export async function removeHelper (actor: Actor, estateId: string, helperId: string) {
    const db = getDb()
    const [h] = await db.select().from(unitHelpers).where(and(eq(unitHelpers.id, helperId), eq(unitHelpers.estateId, estateId)))
    if (!h) throw new NotFoundError('Helper')
    await requireUnitManager(actor, estateId, h.unitId)
    await db.update(unitHelpers).set({ isActive: false }).where(eq(unitHelpers.id, helperId))
}

export async function countResidents (actor: Actor, estateId: string) {
    await requireStaffRole(actor, estateId, ['estate_admin', 'finance_officer'])
    const [row] = await getDb().select({
        active: sql<number>`count(*) filter (where ${occupancies.status} = 'active')::int`,
        pending: sql<number>`count(*) filter (where ${occupancies.status} = 'pending')::int`,
    }).from(occupancies).where(eq(occupancies.estateId, estateId))
    return row
}

/** A resident's own home: only for the occupant themself, while their occupancy is active. */
export async function getMyHome (actor: Actor, occupancyId: string) {
    const db = getDb()
    const [row] = await db.select({ occupancy: occupancies, unit: units, zone: zones, estateName: estates.name })
        .from(occupancies)
        .innerJoin(units, eq(units.id, occupancies.unitId)).innerJoin(zones, eq(zones.id, units.zoneId))
        .innerJoin(estates, eq(estates.id, occupancies.estateId))
        .where(and(eq(occupancies.id, occupancyId), eq(occupancies.userId, actor.userId), eq(occupancies.status, 'active')))
    if (!row) throw new NotFoundError('Home')
    const unitId = row.unit.id
    const [household, veh, helpers] = await Promise.all([
        db.select({ id: occupancies.id, name: occupancies.name, relation: occupancies.relation, isPrimary: occupancies.isPrimary })
            .from(occupancies).where(and(eq(occupancies.unitId, unitId), eq(occupancies.status, 'active'))).orderBy(asc(occupancies.name)),
        db.select().from(vehicles).where(and(eq(vehicles.unitId, unitId), eq(vehicles.isActive, true))).orderBy(asc(vehicles.createdAt)),
        db.select().from(unitHelpers).where(and(eq(unitHelpers.unitId, unitId), eq(unitHelpers.isActive, true))).orderBy(asc(unitHelpers.createdAt)),
    ])
    return { ...row, household, vehicles: veh, helpers }
}
