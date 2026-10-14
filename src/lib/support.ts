import { and, desc, eq, gt, isNull } from 'drizzle-orm'

import { withDbContext } from '@/db'
import { estates, supportAccessGrants, users } from '@/db/schema'
import { type Actor, requireCapability, requirePlatformAdmin } from '@/lib/access'
import { recordAudit } from '@/lib/audit'
import { AppError, NotFoundError } from '@/lib/errors'

export const SUPPORT_ACCESS_HOURS = 2
export const MIN_REASON_LENGTH = 10

/**
 * A platform admin opens read-only access to one estate for a short time. The grant and every page viewed
 * under it are written to the estate's audit log, which the estate admin can read.
 */
export async function grantSupportAccess (actor: Actor, estateId: string, reason: string) {
    requirePlatformAdmin(actor)
    const why = reason.trim()
    if (why.length < MIN_REASON_LENGTH) throw new AppError(`Explain why you need access (at least ${MIN_REASON_LENGTH} characters), e.g. the support ticket.`)
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        const [estate] = await tx.select({ id: estates.id }).from(estates).where(eq(estates.id, estateId))
        if (!estate) throw new NotFoundError('Estate')
        const expiresAt = new Date(Date.now() + SUPPORT_ACCESS_HOURS * 3_600_000)
        const [grant] = await tx.insert(supportAccessGrants).values({ estateId, userId: actor.userId, reason: why.slice(0, 500), expiresAt }).returning()
        await recordAudit(tx, {
            estateId, actorUserId: actor.userId, action: 'support.granted', entityType: 'support_access_grant', entityId: grant.id,
            details: { reason: grant.reason, expiresAt: expiresAt.toISOString() },
        })
        return grant
    })
}

export async function revokeSupportAccess (actor: Actor, estateId: string) {
    requirePlatformAdmin(actor)
    await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        const revoked = await tx.update(supportAccessGrants).set({ revokedAt: new Date() })
            .where(and(eq(supportAccessGrants.estateId, estateId), eq(supportAccessGrants.userId, actor.userId), isNull(supportAccessGrants.revokedAt), gt(supportAccessGrants.expiresAt, new Date())))
            .returning({ id: supportAccessGrants.id })
        if (revoked.length) await recordAudit(tx, { estateId, actorUserId: actor.userId, action: 'support.revoked' })
    })
}

/** Logged for each staff-area page a support user opens. */
export async function recordSupportView (actor: Actor, estateId: string, page: string) {
    await withDbContext({ estateId, userId: actor.userId }, (tx) =>
        recordAudit(tx, { estateId, actorUserId: actor.userId, action: 'support.viewed', details: { page } }))
}

/** For the estate admin: who from Teeco accessed the estate, when and why. */
export async function listSupportGrants (actor: Actor, estateId: string) {
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'audit.read')
        return tx.select({
            id: supportAccessGrants.id,
            reason: supportAccessGrants.reason,
            createdAt: supportAccessGrants.createdAt,
            expiresAt: supportAccessGrants.expiresAt,
            revokedAt: supportAccessGrants.revokedAt,
            name: users.name,
            phone: users.phone,
        }).from(supportAccessGrants)
            .innerJoin(users, eq(users.id, supportAccessGrants.userId))
            .where(eq(supportAccessGrants.estateId, estateId))
            .orderBy(desc(supportAccessGrants.createdAt))
            .limit(50)
    })
}
