import { and, desc, eq } from 'drizzle-orm'

import { type Queryable, withDbContext } from '@/db'
import { auditLogs, users } from '@/db/schema'
import { type Actor, requireCapability } from '@/lib/access'

export interface AuditEntry {
    estateId: string | null
    actorUserId: string | null
    action: string
    entityType?: string
    entityId?: string
    details?: Record<string, unknown>
}

/** Records a sensitive action. Call inside the same transaction as the change so both commit together. */
export async function recordAudit (tx: Queryable, entry: AuditEntry): Promise<void> {
    await tx.insert(auditLogs).values({
        estateId: entry.estateId,
        actorUserId: entry.actorUserId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        details: entry.details ?? {},
    })
}

export async function listAuditLog (actor: Actor, estateId: string, opts: { action?: string, limit?: number } = {}) {
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'audit.read')
        return tx.select({
            id: auditLogs.id,
            action: auditLogs.action,
            details: auditLogs.details,
            createdAt: auditLogs.createdAt,
            actorName: users.name,
            actorPhone: users.phone,
        }).from(auditLogs)
            .leftJoin(users, eq(users.id, auditLogs.actorUserId))
            .where(and(eq(auditLogs.estateId, estateId), opts.action ? eq(auditLogs.action, opts.action) : undefined))
            .orderBy(desc(auditLogs.createdAt))
            .limit(opts.limit ?? 100)
    })
}
