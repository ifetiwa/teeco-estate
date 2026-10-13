import { and, eq } from 'drizzle-orm'

import { getDb } from '@/db'
import { memberships, occupancies } from '@/db/schema'
import { ForbiddenError } from '@/lib/errors'

export type StaffRole = typeof memberships.$inferSelect['role']

/** Who is performing an action. Built from the signed-in user. */
export interface Actor {
    userId: string
    isPlatformAdmin: boolean
}

export function actorFromUser (user: { id: string, isPlatformAdmin: boolean }): Actor {
    return { userId: user.id, isPlatformAdmin: user.isPlatformAdmin }
}

export interface EstateAccess {
    staffRoles: StaffRole[]
    /** Unit ids where the actor is a current (active) occupant */
    residentUnitIds: string[]
}

export async function getEstateAccess (actor: Actor, estateId: string): Promise<EstateAccess> {
    const db = getDb()
    const [staff, occ] = await Promise.all([
        db.select({ role: memberships.role }).from(memberships)
            .where(and(eq(memberships.estateId, estateId), eq(memberships.userId, actor.userId), eq(memberships.isActive, true))),
        db.select({ unitId: occupancies.unitId }).from(occupancies)
            .where(and(eq(occupancies.estateId, estateId), eq(occupancies.userId, actor.userId), eq(occupancies.status, 'active'))),
    ])
    return { staffRoles: staff.map(s => s.role), residentUnitIds: occ.map(o => o.unitId) }
}

/** Throws unless the actor holds one of the given staff roles in the estate. */
export async function requireStaffRole (actor: Actor, estateId: string, allowed: StaffRole[]): Promise<EstateAccess> {
    const access = await getEstateAccess(actor, estateId)
    if (!access.staffRoles.some(r => allowed.includes(r))) throw new ForbiddenError()
    return access
}

export function requirePlatformAdmin (actor: Actor): void {
    if (!actor.isPlatformAdmin) throw new ForbiddenError()
}
