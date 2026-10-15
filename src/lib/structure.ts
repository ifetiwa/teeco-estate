import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { inOrder, withDbContext } from '@/db'
import { occupancies, unitHelpers, unitType, units, vehicles, zoneKind, zones } from '@/db/schema'
import { type Actor, requireCapability } from '@/lib/access'
import { AppError, NotFoundError, isUniqueViolation } from '@/lib/errors'

export const MAX_UNITS_PER_BATCH = 500

/**
 * Expands "1-20, 22, 24A, Block C" into individual labels. Numeric ranges keep any shared prefix
 * ("B1-B4" -> B1, B2, B3, B4). Duplicates are removed, order is preserved.
 */
export function parseUnitLabels (input: string): string[] {
    const out: string[] = []
    for (const raw of input.split(/[,\n;]/)) {
        const part = raw.trim().replace(/\s+/g, ' ')
        if (!part) continue
        const range = part.match(/^([A-Za-z]*\s?)(\d+)\s*[-–]\s*\1?(\d+)$/)
        if (range) {
            const [, prefix, fromStr, toStr] = range
            const from = Number(fromStr)
            const to = Number(toStr)
            if (to < from) throw new AppError(`Range "${part}" goes backwards.`)
            if (to - from + 1 > MAX_UNITS_PER_BATCH) throw new AppError(`Range "${part}" is too large (max ${MAX_UNITS_PER_BATCH}).`)
            for (let n = from; n <= to; n++) out.push(`${prefix}${n}`)
        } else {
            if (part.length > 40) throw new AppError(`"${part.slice(0, 20)}…" is too long for a house or flat number.`)
            out.push(part)
        }
    }
    const seen = new Set<string>()
    const unique = out.filter(l => (seen.has(l.toLowerCase()) ? false : (seen.add(l.toLowerCase()), true)))
    if (unique.length > MAX_UNITS_PER_BATCH) throw new AppError(`At most ${MAX_UNITS_PER_BATCH} units at a time.`)
    return unique
}

export const zoneSchema = z.object({
    name: z.string().trim().min(1, 'Enter a name').max(120),
    kind: z.enum(zoneKind.enumValues).default('street'),
})

export async function createZone (actor: Actor, estateId: string, input: z.input<typeof zoneSchema>) {
    const data = zoneSchema.parse(input)
    try {
        return await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
            await requireCapability(tx, actor, estateId, 'structure.manage')
            const [row] = await tx.insert(zones).values({ estateId, ...data }).returning()
            return row
        })
    } catch (e) {
        if (isUniqueViolation(e)) throw new AppError(`"${data.name}" already exists in this estate.`)
        throw e
    }
}

export const addUnitsSchema = z.object({
    zoneId: z.uuid(),
    labels: z.string().trim().min(1, 'Enter house or flat numbers'),
    type: z.enum(unitType.enumValues).default('house'),
})

/** Adds units to a street/block. Labels that already exist are skipped and reported. */
export async function addUnits (actor: Actor, estateId: string, input: z.input<typeof addUnitsSchema>) {
    const data = addUnitsSchema.parse(input)
    const labels = parseUnitLabels(data.labels)
    if (labels.length === 0) throw new AppError('Enter house or flat numbers.')
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'structure.manage')
        const [zone] = await tx.select({ id: zones.id }).from(zones).where(and(eq(zones.id, data.zoneId), eq(zones.estateId, estateId)))
        if (!zone) throw new NotFoundError('Street or block')
        const created = await tx.insert(units)
            .values(labels.map(label => ({ estateId, zoneId: zone.id, label, type: data.type })))
            .onConflictDoNothing()
            .returning({ id: units.id, label: units.label })
        const createdLabels = new Set(created.map(c => c.label.toLowerCase()))
        return { created, skipped: labels.filter(l => !createdLabels.has(l.toLowerCase())) }
    })
}

export async function setUnitActive (actor: Actor, estateId: string, unitId: string, isActive: boolean) {
    await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'structure.manage')
        if (!isActive) {
            const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(occupancies)
                .where(and(eq(occupancies.unitId, unitId), inArray(occupancies.status, ['pending', 'active'])))
            if (count > 0) throw new AppError('Move out the current residents before deactivating this unit.')
        }
        const res = await tx.update(units).set({ isActive }).where(and(eq(units.id, unitId), eq(units.estateId, estateId))).returning({ id: units.id })
        if (res.length === 0) throw new NotFoundError('Unit')
    })
}

/** Streets/blocks with their units and current-occupant counts. */
export async function listZonesWithUnits (actor: Actor, estateId: string) {
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'structure.view')
        const zoneRows = await tx.select().from(zones).where(eq(zones.estateId, estateId)).orderBy(asc(zones.name))
        const unitRows = await tx.select({
            id: units.id,
            zoneId: units.zoneId,
            label: units.label,
            type: units.type,
            isActive: units.isActive,
            occupantCount: sql<number>`(select count(*)::int from occupancies o where o.unit_id = "units"."id" and o.status = 'active')`,
        }).from(units).where(eq(units.estateId, estateId))
        const collator = new Intl.Collator('en', { numeric: true })
        return zoneRows.map(z => ({
            ...z,
            units: unitRows.filter(u => u.zoneId === z.id).sort((a, b) => collator.compare(a.label, b.label)),
        }))
    })
}

/** Unit page: occupants (including history), vehicles, helpers. */
export async function getUnitDetail (actor: Actor, estateId: string, unitId: string) {
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'residents.read')
        const [unit] = await tx.select({ unit: units, zone: zones }).from(units)
            .innerJoin(zones, eq(zones.id, units.zoneId))
            .where(and(eq(units.id, unitId), eq(units.estateId, estateId)))
        if (!unit) throw new NotFoundError('Unit')
        const [occ, veh, helpers] = await inOrder([
            tx.select().from(occupancies).where(eq(occupancies.unitId, unitId)).orderBy(asc(occupancies.createdAt)),
            tx.select().from(vehicles).where(and(eq(vehicles.unitId, unitId), eq(vehicles.isActive, true))).orderBy(asc(vehicles.createdAt)),
            tx.select().from(unitHelpers).where(and(eq(unitHelpers.unitId, unitId), eq(unitHelpers.isActive, true))).orderBy(asc(unitHelpers.createdAt)),
        ])
        return { ...unit, occupants: occ, vehicles: veh, helpers }
    })
}
