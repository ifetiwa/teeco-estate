import { and, asc, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'

import { withDbContext } from '@/db'
import { memberships, staffRole, users } from '@/db/schema'
import { type Actor, requireCapability } from '@/lib/access'
import { recordAudit } from '@/lib/audit'
import { ensureUserByPhone } from '@/lib/estates'
import { AppError, NotFoundError } from '@/lib/errors'
import { normalizeNigerianPhone } from '@/lib/phone'

export const addStaffSchema = z.object({
    name: z.string().trim().min(2, 'Enter their name').max(120),
    phone: z.string().refine(v => normalizeNigerianPhone(v), 'Enter a valid Nigerian phone number'),
    role: z.enum(staffRole.enumValues),
})

export async function listStaff (actor: Actor, estateId: string) {
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'staff.manage')
        return tx.select({
            id: memberships.id,
            role: memberships.role,
            isActive: memberships.isActive,
            createdAt: memberships.createdAt,
            userId: users.id,
            name: users.name,
            phone: users.phone,
        }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
            .where(eq(memberships.estateId, estateId))
            .orderBy(asc(memberships.role), asc(users.name))
    })
}

/** Gives a person a staff role (estate admin, finance officer or guard). Reactivates it if it was removed. */
export async function addStaff (actor: Actor, estateId: string, input: z.input<typeof addStaffSchema>) {
    const data = addStaffSchema.parse(input)
    await withDbContext({ estateId, userId: actor.userId }, tx => requireCapability(tx, actor, estateId, 'staff.manage'))
    const userId = await ensureUserByPhone(data.phone, data.name)
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'staff.manage')
        const [row] = await tx.insert(memberships).values({ estateId, userId, role: data.role })
            .onConflictDoUpdate({ target: [memberships.estateId, memberships.userId, memberships.role], set: { isActive: true } })
            .returning()
        await recordAudit(tx, { estateId, actorUserId: actor.userId, action: 'staff.role_added', entityType: 'membership', entityId: row.id, details: { role: data.role, userId } })
        return row
    })
}

/** Removes a staff role. The last active estate admin cannot be removed. */
export async function removeStaff (actor: Actor, estateId: string, membershipId: string) {
    await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'staff.manage')
        const [m] = await tx.select().from(memberships).where(and(eq(memberships.id, membershipId), eq(memberships.estateId, estateId)))
        if (!m || !m.isActive) throw new NotFoundError('Staff role')
        if (m.role === 'estate_admin') {
            const [{ others }] = await tx.select({ others: sql<number>`count(*)::int` }).from(memberships)
                .where(and(eq(memberships.estateId, estateId), eq(memberships.role, 'estate_admin'), eq(memberships.isActive, true), ne(memberships.id, m.id)))
            if (others === 0) throw new AppError('An estate must keep at least one estate admin. Add another admin first.')
        }
        await tx.update(memberships).set({ isActive: false }).where(eq(memberships.id, m.id))
        await recordAudit(tx, { estateId, actorUserId: actor.userId, action: 'staff.role_removed', entityType: 'membership', entityId: m.id, details: { role: m.role, userId: m.userId } })
    })
}
