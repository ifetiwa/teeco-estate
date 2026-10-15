import { and, asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { resolveEstateSettings } from '@/config/defaults'
import { getDb, inOrder, withDbContext } from '@/db'
import { estates, memberships, occupancies, units, users, zones } from '@/db/schema'
import { type Actor, type EstateAccess, getEstateAccess, requireCapability, requirePlatformAdmin } from '@/lib/access'
import { recordAudit } from '@/lib/audit'
import { randomCode } from '@/lib/crypto'
import { AppError, ForbiddenError, NotFoundError, isUniqueViolation } from '@/lib/errors'
import { normalizeNigerianPhone, requireNigerianPhone } from '@/lib/phone'

export type Estate = typeof estates.$inferSelect

const optionalText = z.string().trim().max(200).optional().transform(v => v || undefined)

export const estateDetailsSchema = z.object({
    name: z.string().trim().min(2, 'Enter the estate name').max(120),
    street: z.string().trim().max(200).default(''),
    district: z.string().trim().max(80).default(''),
    city: z.string().trim().min(1).max(80).default('Abuja'),
    state: z.string().trim().min(1).max(80).default('FCT'),
    contactPhone: optionalText.refine(v => !v || normalizeNigerianPhone(v), 'Enter a valid Nigerian phone number')
        .transform(v => (v ? normalizeNigerianPhone(v)! : undefined)),
    contactEmail: z.union([z.literal(''), z.email('Enter a valid email')]).optional().transform(v => v || undefined),
    gateCount: z.coerce.number().int().min(1, 'At least one gate').max(20),
})

export const createEstateSchema = estateDetailsSchema.extend({
    adminName: z.string().trim().min(2, 'Enter the estate admin\'s name').max(120),
    adminPhone: z.string().refine(v => normalizeNigerianPhone(v), 'Enter a valid Nigerian phone number'),
})

/** Finds or creates the user with this phone, filling in the name if it is still empty. (users is a global table.) */
export async function ensureUserByPhone (rawPhone: string, name?: string): Promise<string> {
    const phone = requireNigerianPhone(rawPhone)
    const [row] = await getDb().insert(users).values({ phone, name: name ?? '' })
        .onConflictDoUpdate({
            target: users.phone,
            set: { name: sql`case when ${users.name} = '' then excluded.name else ${users.name} end` },
        })
        .returning({ id: users.id })
    return row.id
}

async function withUniqueJoinCode<T> (attempt: (joinCode: string) => Promise<T>): Promise<T> {
    for (let i = 0; i < 5; i++) {
        try {
            return await attempt(randomCode(6))
        } catch (e) {
            if (!isUniqueViolation(e)) throw e
        }
    }
    throw new Error('Could not generate a unique join code')
}

/** Platform admin creates an estate and its first estate admin. */
export async function createEstate (actor: Actor, input: z.input<typeof createEstateSchema>): Promise<Estate> {
    requirePlatformAdmin(actor)
    const data = createEstateSchema.parse(input)
    const adminUserId = await ensureUserByPhone(data.adminPhone, data.adminName)
    return withUniqueJoinCode(joinCode => withDbContext({ system: true, userId: actor.userId }, async (tx) => {
        const [estate] = await tx.insert(estates).values({
            name: data.name,
            street: data.street,
            district: data.district,
            city: data.city,
            state: data.state,
            contactPhone: data.contactPhone,
            contactEmail: data.contactEmail,
            gateCount: data.gateCount,
            joinCode,
        }).returning()
        const [m] = await tx.insert(memberships).values({ estateId: estate.id, userId: adminUserId, role: 'estate_admin' }).returning()
        await recordAudit(tx, { estateId: estate.id, actorUserId: actor.userId, action: 'estate.created', entityType: 'estate', entityId: estate.id, details: { name: estate.name } })
        await recordAudit(tx, { estateId: estate.id, actorUserId: actor.userId, action: 'staff.role_added', entityType: 'membership', entityId: m.id, details: { role: 'estate_admin', userId: adminUserId } })
        return estate
    }))
}

export async function updateEstateDetails (actor: Actor, estateId: string, input: z.input<typeof estateDetailsSchema>): Promise<Estate> {
    const data = estateDetailsSchema.parse(input)
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'estate.manage')
        const [row] = await tx.update(estates).set({
            name: data.name,
            street: data.street,
            district: data.district,
            city: data.city,
            state: data.state,
            contactPhone: data.contactPhone ?? null,
            contactEmail: data.contactEmail ?? null,
            gateCount: data.gateCount,
        }).where(eq(estates.id, estateId)).returning()
        if (!row) throw new NotFoundError('Estate')
        return row
    })
}

export async function setEstateLogo (actor: Actor, estateId: string, logoPath: string | null): Promise<void> {
    await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'estate.manage')
        await tx.update(estates).set({ logoPath }).where(eq(estates.id, estateId))
    })
}

export async function regenerateJoinCode (actor: Actor, estateId: string): Promise<string> {
    return withUniqueJoinCode(joinCode => withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'estate.manage')
        await tx.update(estates).set({ joinCode }).where(eq(estates.id, estateId))
        return joinCode
    }))
}

/** Estate record plus the actor's access, for anyone allowed into the staff area (staff or Teeco support). */
export async function getEstateForStaff (actor: Actor, estateId: string): Promise<{ estate: Estate, access: EstateAccess }> {
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        const access = await getEstateAccess(tx, actor, estateId)
        if (!access.capabilities.has('estate.view')) throw new ForbiddenError()
        const [estate] = await tx.select().from(estates).where(eq(estates.id, estateId))
        if (!estate) throw new NotFoundError('Estate')
        return { estate, access }
    })
}

export function estateSettings (estate: Pick<Estate, 'settings'>) {
    return resolveEstateSettings(estate.settings)
}

/** Public lookup used during self-registration: only what a prospective resident needs to see. */
export async function findEstateByJoinCode (rawCode: string) {
    const code = rawCode.trim().toUpperCase().replace(/[\s-]/g, '')
    if (!/^[A-Z0-9]{6}$/.test(code)) throw new AppError('Join codes are 6 letters and numbers. Check the code and try again.')
    // System context only to resolve the code to one estate; units are then read in that estate's context.
    const [estate] = await withDbContext({ system: true }, tx =>
        tx.select({ id: estates.id, name: estates.name, district: estates.district, status: estates.status })
            .from(estates).where(eq(estates.joinCode, code)))
    if (!estate) throw new AppError('No estate uses that join code. Check with your estate office.')
    const rows = await withDbContext({ estateId: estate.id }, tx =>
        tx.select({ zoneId: zones.id, zoneName: zones.name, unitId: units.id, unitLabel: units.label })
            .from(units).innerJoin(zones, eq(zones.id, units.zoneId))
            .where(and(eq(units.estateId, estate.id), eq(units.isActive, true)))
            .orderBy(asc(zones.name), asc(units.label)))
    const collator = new Intl.Collator('en', { numeric: true })
    rows.sort((a, b) => collator.compare(a.zoneName, b.zoneName) || collator.compare(a.unitLabel, b.unitLabel))
    return { estate, units: rows }
}

export interface MyEstate {
    id: string
    name: string
    staffRoles: string[]
    residentStatus: 'pending' | 'active' | null
}

/** Estates the user works in or lives in, for the home screen. Runs in the user's own context. */
export async function listMyEstates (actor: Actor): Promise<MyEstate[]> {
    const [staff, occ] = await withDbContext({ userId: actor.userId }, tx => inOrder([
        tx.select({ id: estates.id, name: estates.name, role: memberships.role }).from(memberships)
            .innerJoin(estates, eq(estates.id, memberships.estateId))
            .where(and(eq(memberships.userId, actor.userId), eq(memberships.isActive, true))),
        tx.select({ id: estates.id, name: estates.name, status: occupancies.status }).from(occupancies)
            .innerJoin(estates, eq(estates.id, occupancies.estateId))
            .where(and(eq(occupancies.userId, actor.userId), sql`${occupancies.status} in ('pending', 'active')`)),
    ]))
    const byId = new Map<string, MyEstate>()
    const get = (id: string, name: string) => {
        if (!byId.has(id)) byId.set(id, { id, name, staffRoles: [], residentStatus: null })
        return byId.get(id)!
    }
    for (const s of staff) get(s.id, s.name).staffRoles.push(s.role)
    for (const o of occ) {
        const e = get(o.id, o.name)
        if (o.status === 'active' || e.residentStatus === null) e.residentStatus = o.status as 'pending' | 'active'
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Platform overview: estate names and counts only, never resident data. */
export async function listAllEstates (actor: Actor) {
    requirePlatformAdmin(actor)
    return withDbContext({ system: true }, tx => tx.select({
        id: estates.id,
        name: estates.name,
        district: estates.district,
        status: estates.status,
        createdAt: estates.createdAt,
        unitCount: sql<number>`(select count(*)::int from units u where u.estate_id = "estates"."id")`,
        residentCount: sql<number>`(select count(*)::int from occupancies o where o.estate_id = "estates"."id" and o.status = 'active')`,
    }).from(estates).orderBy(asc(estates.name)))
}
