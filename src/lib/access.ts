import { and, eq, gt, isNull } from 'drizzle-orm'

import type { Queryable } from '@/db'
import { memberships, occupancies, supportAccessGrants } from '@/db/schema'
import { ForbiddenError } from '@/lib/errors'

export type StaffRole = typeof memberships.$inferSelect['role']

/** The five product roles inside an estate, plus Teeco support (platform admin with a logged grant). */
export type EstateRole = StaffRole | 'resident' | 'support'

export type Capability =
    | 'estate.view' // see the estate's staff area
    | 'estate.manage' // edit details, logo, join code
    | 'structure.view' // streets and units
    | 'structure.manage'
    | 'residents.read' // resident list and unit details
    | 'residents.manage' // add, approve, move out
    | 'staff.manage' // assign finance officers and guards
    | 'finance.read' // invoices, payments, arrears (Build 5+)
    | 'finance.manage' // charges, confirm payments, waivers
    | 'gate.operate' // verify visitor codes, check in/out (Build 4)
    | 'visitors.read' // visitor log
    | 'tickets.read'
    | 'tickets.manage'
    | 'notices.manage'
    | 'reports.read'
    | 'audit.read'

const ALL: Capability[] = [
    'estate.view', 'estate.manage', 'structure.view', 'structure.manage', 'residents.read', 'residents.manage', 'staff.manage',
    'finance.read', 'finance.manage', 'gate.operate', 'visitors.read', 'tickets.read', 'tickets.manage', 'notices.manage', 'reports.read', 'audit.read',
]

/**
 * Role → capability matrix. Residents get no estate-wide capabilities: everything they can do is limited to
 * their own unit and is checked by ownership in each module. Support is read-only.
 */
export const ROLE_CAPABILITIES: Record<EstateRole, readonly Capability[]> = {
    estate_admin: ALL,
    finance_officer: ['estate.view', 'structure.view', 'residents.read', 'finance.read', 'finance.manage', 'reports.read'],
    guard: ['estate.view', 'structure.view', 'gate.operate', 'visitors.read'],
    resident: [],
    support: ['estate.view', 'structure.view', 'residents.read', 'finance.read', 'visitors.read', 'tickets.read', 'reports.read', 'audit.read'],
}

/** Who is performing an action. Built from the signed-in user. */
export interface Actor {
    userId: string
    isPlatformAdmin: boolean
}

export function actorFromUser (user: { id: string, isPlatformAdmin: boolean }): Actor {
    return { userId: user.id, isPlatformAdmin: user.isPlatformAdmin }
}

export interface EstateAccess {
    roles: EstateRole[]
    staffRoles: StaffRole[]
    /** Unit ids where the actor is a current (active) occupant */
    residentUnitIds: string[]
    capabilities: ReadonlySet<Capability>
    /** True when the only reason the actor can see this estate is a support grant */
    viaSupport: boolean
}

export function capabilitiesFor (roles: EstateRole[]): Set<Capability> {
    return new Set(roles.flatMap(r => ROLE_CAPABILITIES[r]))
}

/** Must run inside withDbContext({ estateId, userId }) so RLS lets the actor's own rows through. */
export async function getEstateAccess (tx: Queryable, actor: Actor, estateId: string): Promise<EstateAccess> {
    const [staff, occ, grants] = await Promise.all([
        tx.select({ role: memberships.role }).from(memberships)
            .where(and(eq(memberships.estateId, estateId), eq(memberships.userId, actor.userId), eq(memberships.isActive, true))),
        tx.select({ unitId: occupancies.unitId }).from(occupancies)
            .where(and(eq(occupancies.estateId, estateId), eq(occupancies.userId, actor.userId), eq(occupancies.status, 'active'))),
        actor.isPlatformAdmin
            ? tx.select({ id: supportAccessGrants.id }).from(supportAccessGrants)
                .where(and(eq(supportAccessGrants.estateId, estateId), eq(supportAccessGrants.userId, actor.userId),
                    gt(supportAccessGrants.expiresAt, new Date()), isNull(supportAccessGrants.revokedAt)))
                .limit(1)
            : Promise.resolve([]),
    ])
    const staffRoles = staff.map(s => s.role)
    const roles: EstateRole[] = [...staffRoles]
    if (occ.length > 0) roles.push('resident')
    if (grants.length > 0) roles.push('support')
    return {
        roles,
        staffRoles,
        residentUnitIds: occ.map(o => o.unitId),
        capabilities: capabilitiesFor(roles),
        viaSupport: grants.length > 0 && staffRoles.length === 0,
    }
}

/** Throws unless the actor has the capability in this estate. */
export async function requireCapability (tx: Queryable, actor: Actor, estateId: string, capability: Capability): Promise<EstateAccess> {
    const access = await getEstateAccess(tx, actor, estateId)
    if (!access.capabilities.has(capability)) throw new ForbiddenError()
    return access
}

export function requirePlatformAdmin (actor: Actor): void {
    if (!actor.isPlatformAdmin) throw new ForbiddenError()
}
