import { and, asc, desc, eq, gte, ilike, isNull, lte, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import { type Queryable, inOrder, withDbContext } from '@/db'
import { chargeKind, levyPayments, paymentMethod, units, users, zones } from '@/db/schema'
import { type Actor, getEstateAccess, requireCapability } from '@/lib/access'
import { recordAudit } from '@/lib/audit'
import { AppError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { formatNaira, parseNairaToKobo } from '@/lib/format'
import { notifyUnitResidents } from '@/lib/notifications'

export type LevyPayment = typeof levyPayments.$inferSelect
export type ChargeKind = LevyPayment['kind']
export type PaymentMethod = LevyPayment['method']

export const CHARGE_KIND_LABEL: Record<ChargeKind, string> = {
    security_levy: 'Security levy',
    service_charge: 'Service charge',
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
    bank_transfer: 'Bank transfer',
    cash: 'Cash',
    pos: 'POS',
    online: 'Online',
    other: 'Other',
}

/** Largest single payment we accept (₦100m), to catch typing mistakes such as extra zeros. */
export const MAX_PAYMENT_KOBO = 100_000_000 * 100

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date')
const optionalText = (max: number) => z.string().trim().max(max).optional().transform(v => v || undefined)

export const recordPaymentSchema = z.object({
    unitId: z.uuid('Choose a house'),
    kind: z.enum(chargeKind.enumValues),
    amount: z.string().transform((v, ctx) => {
        const kobo = parseNairaToKobo(v)
        if (kobo === null || kobo <= 0) return (ctx.addIssue({ code: 'custom', message: 'Enter an amount in naira, e.g. 25,000' }), z.NEVER)
        if (kobo > MAX_PAYMENT_KOBO) return (ctx.addIssue({ code: 'custom', message: 'That amount looks too large. Check for extra zeros.' }), z.NEVER)
        return kobo
    }),
    period: z.string().trim().min(2, 'Say what the payment covers, e.g. October 2026').max(60),
    paidOn: isoDate,
    method: z.enum(paymentMethod.enumValues).default('bank_transfer'),
    reference: optionalText(80),
    payerName: optionalText(120),
    note: optionalText(300),
})

/** Today's date in Lagos as YYYY-MM-DD. */
function lagosToday (now: Date = new Date()): string {
    return new Date(now.getTime() + 60 * 60_000).toISOString().slice(0, 10)
}

async function unitLabel (tx: Queryable, estateId: string, unitId: string) {
    const [u] = await tx.select({ label: units.label, zoneName: zones.name }).from(units)
        .innerJoin(zones, eq(zones.id, units.zoneId))
        .where(and(eq(units.id, unitId), eq(units.estateId, estateId)))
    if (!u) throw new NotFoundError('House')
    return `${u.label}, ${u.zoneName}`
}

/** Finance staff record a payment received from a house. The house's residents are told in-app. */
export async function recordPayment (actor: Actor, estateId: string, input: z.input<typeof recordPaymentSchema>, now: Date = new Date()): Promise<LevyPayment> {
    const data = recordPaymentSchema.parse(input)
    if (data.paidOn > lagosToday(now)) throw new AppError('The payment date cannot be in the future.')
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'finance.manage')
        const house = await unitLabel(tx, estateId, data.unitId)
        const [payment] = await tx.insert(levyPayments).values({
            estateId,
            unitId: data.unitId,
            kind: data.kind,
            amountKobo: data.amount,
            period: data.period,
            paidOn: data.paidOn,
            method: data.method,
            reference: data.reference,
            payerName: data.payerName,
            note: data.note,
            recordedBy: actor.userId,
        }).returning()
        await recordAudit(tx, {
            estateId, actorUserId: actor.userId, action: 'payment.recorded', entityType: 'levy_payment', entityId: payment.id,
            details: { unit: house, kind: data.kind, amountKobo: data.amount, period: data.period },
        })
        await notifyUnitResidents(tx, data.unitId, {
            estateId,
            type: 'payment.recorded',
            title: 'Payment recorded',
            body: `${formatNaira(data.amount)} ${CHARGE_KIND_LABEL[data.kind].toLowerCase()} for ${data.period} was recorded for ${house}.`,
        })
        return payment
    })
}

/** Payments are never deleted; a mistake is voided with a reason and stays visible in the history. */
export async function voidPayment (actor: Actor, estateId: string, paymentId: string, reason: string): Promise<void> {
    const why = reason.trim()
    if (why.length < 5) throw new AppError('Give a reason (at least 5 characters).')
    await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'finance.manage')
        const [p] = await tx.select().from(levyPayments).where(and(eq(levyPayments.id, paymentId), eq(levyPayments.estateId, estateId)))
        if (!p) throw new NotFoundError('Payment')
        if (p.voidedAt) throw new AppError('This payment is already voided.')
        await tx.update(levyPayments).set({ voidedAt: new Date(), voidedBy: actor.userId, voidReason: why }).where(eq(levyPayments.id, paymentId))
        await recordAudit(tx, {
            estateId, actorUserId: actor.userId, action: 'payment.voided', entityType: 'levy_payment', entityId: paymentId,
            details: { amountKobo: p.amountKobo, kind: p.kind, reason: why },
        })
    })
}

export interface PaymentFilter {
    kind?: string
    q?: string
    from?: string
    to?: string
    includeVoided?: boolean
    limit?: number
}

function filterConditions (estateId: string, f: PaymentFilter) {
    const kind = (chargeKind.enumValues as readonly string[]).includes(f.kind ?? '') ? f.kind as ChargeKind : undefined
    const q = f.q?.trim()
    return and(
        eq(levyPayments.estateId, estateId),
        kind ? eq(levyPayments.kind, kind) : undefined,
        f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from) ? gte(levyPayments.paidOn, f.from) : undefined,
        f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to) ? lte(levyPayments.paidOn, f.to) : undefined,
        q ? or(ilike(units.label, `%${q}%`), ilike(zones.name, `%${q}%`), ilike(levyPayments.reference, `%${q}%`),
            ilike(levyPayments.payerName, `%${q}%`), ilike(levyPayments.period, `%${q}%`)) : undefined,
    )
}

/** The estate's payment records with totals by charge, for finance staff. */
export async function listPayments (actor: Actor, estateId: string, f: PaymentFilter = {}) {
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'finance.read')
        const where = filterConditions(estateId, f)
        const [rows, totals] = await inOrder([
            tx.select({ payment: levyPayments, unitLabel: units.label, zoneName: zones.name, recordedByName: users.name })
                .from(levyPayments)
                .innerJoin(units, eq(units.id, levyPayments.unitId)).innerJoin(zones, eq(zones.id, units.zoneId))
                .leftJoin(users, eq(users.id, levyPayments.recordedBy))
                .where(and(where, f.includeVoided ? undefined : isNull(levyPayments.voidedAt)))
                .orderBy(desc(levyPayments.paidOn), desc(levyPayments.createdAt))
                .limit(f.limit ?? 200),
            tx.select({ kind: levyPayments.kind, total: sql<string>`coalesce(sum(${levyPayments.amountKobo}), 0)`, count: sql<number>`count(*)::int` })
                .from(levyPayments)
                .innerJoin(units, eq(units.id, levyPayments.unitId)).innerJoin(zones, eq(zones.id, units.zoneId))
                .where(and(where, isNull(levyPayments.voidedAt)))
                .groupBy(levyPayments.kind),
        ])
        const byKind = Object.fromEntries(chargeKind.enumValues.map(k => {
            const t = totals.find(r => r.kind === k)
            return [k, { totalKobo: Number(t?.total ?? 0), count: t?.count ?? 0 }]
        })) as Record<ChargeKind, { totalKobo: number, count: number }>
        return { rows, byKind, totalKobo: byKind.security_levy.totalKobo + byKind.service_charge.totalKobo }
    })
}

/** Amount paid per house for each charge (excluding voided), in the date range. Houses with no payments are included. */
export async function paymentsByUnit (actor: Actor, estateId: string, f: Pick<PaymentFilter, 'from' | 'to'> = {}) {
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'finance.read')
        const inRange = and(
            eq(levyPayments.unitId, units.id),
            isNull(levyPayments.voidedAt),
            f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from) ? gte(levyPayments.paidOn, f.from) : undefined,
            f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to) ? lte(levyPayments.paidOn, f.to) : undefined,
        )
        const rows = await tx.select({
            unitId: units.id,
            unitLabel: units.label,
            zoneName: zones.name,
            security: sql<string>`coalesce(sum(${levyPayments.amountKobo}) filter (where ${levyPayments.kind} = 'security_levy'), 0)`,
            service: sql<string>`coalesce(sum(${levyPayments.amountKobo}) filter (where ${levyPayments.kind} = 'service_charge'), 0)`,
            lastPaidOn: sql<string | null>`max(${levyPayments.paidOn})::text`,
        }).from(units)
            .innerJoin(zones, eq(zones.id, units.zoneId))
            .leftJoin(levyPayments, inRange)
            .where(and(eq(units.estateId, estateId), eq(units.isActive, true)))
            .groupBy(units.id, units.label, zones.name)
            .orderBy(asc(zones.name), asc(units.label))
        return rows.map(r => ({ ...r, securityKobo: Number(r.security), serviceKobo: Number(r.service) }))
    })
}

/** A house's own payment history, for its residents (or finance staff). */
export async function listUnitPayments (actor: Actor, estateId: string, unitId: string) {
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        const access = await getEstateAccess(tx, actor, estateId)
        if (!access.residentUnitIds.includes(unitId) && !access.capabilities.has('finance.read')) throw new ForbiddenError()
        const rows = await tx.select().from(levyPayments)
            .where(and(eq(levyPayments.estateId, estateId), eq(levyPayments.unitId, unitId)))
            .orderBy(desc(levyPayments.paidOn), desc(levyPayments.createdAt))
            .limit(100)
        const valid = rows.filter(r => !r.voidedAt)
        const sum = (k: ChargeKind) => valid.filter(r => r.kind === k).reduce((t, r) => t + r.amountKobo, 0)
        return { rows, securityKobo: sum('security_levy'), serviceKobo: sum('service_charge') }
    })
}
