import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import { type EstateSettings, resolveEstateSettings } from '@/config/defaults'
import { type Queryable, inOrder, withDbContext } from '@/db'
import { chargeKind, estates, levyPayments, notifications, occupancies, paymentMethod, paymentReminders, units, users, zones } from '@/db/schema'
import { type Actor, getEstateAccess, requireCapability } from '@/lib/access'
import { recordAudit } from '@/lib/audit'
import { AppError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { formatNaira, parseNairaToKobo } from '@/lib/format'
import { type PendingSms, notifyUnitResidents, sendPendingSms } from '@/lib/notifications'
import {
    type Frequency, amountTowards, lagosMonth, monthDate, parseMonth, periodKeyFor, periodLabel, periodRange, rangeLabel, yearOf,
} from '@/lib/periods'

export type LevyPayment = typeof levyPayments.$inferSelect
export type ChargeKind = LevyPayment['kind']
export type PaymentMethod = LevyPayment['method']

export const CHARGE_KINDS = chargeKind.enumValues

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
/** Longest stretch one payment can cover. */
export const MAX_COVER_MONTHS = 36
/** A house isn't reminded about the same charge and period more than once in this window. */
export const REMINDER_COOLDOWN_HOURS = 20

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date')
const optionalText = (max: number) => z.string().trim().max(max).optional().transform(v => v || undefined)
const month = (what: string) => z.string().transform((v, ctx) => parseMonth(v) ?? (ctx.addIssue({ code: 'custom', message: `Choose the ${what} month` }), z.NEVER))
const nairaAmount = z.string().transform((v, ctx) => {
    const kobo = parseNairaToKobo(v)
    if (kobo === null || kobo <= 0) return (ctx.addIssue({ code: 'custom', message: 'Enter an amount in naira, e.g. 25,000' }), z.NEVER)
    if (kobo > MAX_PAYMENT_KOBO) return (ctx.addIssue({ code: 'custom', message: 'That amount looks too large. Check for extra zeros.' }), z.NEVER)
    return kobo
})

export const recordPaymentSchema = z.object({
    unitId: z.uuid('Choose a house'),
    kind: z.enum(chargeKind.enumValues),
    amount: nairaAmount,
    coversFrom: month('first'),
    coversTo: z.string().optional().transform((v, ctx) => {
        if (!v?.trim()) return undefined
        return parseMonth(v) ?? (ctx.addIssue({ code: 'custom', message: 'Choose the last month' }), z.NEVER)
    }),
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

async function loadSettings (tx: Queryable, estateId: string): Promise<{ settings: EstateSettings, raw: Record<string, unknown>, name: string }> {
    const [e] = await tx.select({ settings: estates.settings, name: estates.name }).from(estates).where(eq(estates.id, estateId))
    if (!e) throw new NotFoundError('Estate')
    return { settings: resolveEstateSettings(e.settings), raw: (e.settings ?? {}) as Record<string, unknown>, name: e.name }
}

async function unitLabel (tx: Queryable, estateId: string, unitId: string) {
    const [u] = await tx.select({ label: units.label, zoneName: zones.name }).from(units)
        .innerJoin(zones, eq(zones.id, units.zoneId))
        .where(and(eq(units.id, unitId), eq(units.estateId, estateId)))
    if (!u) throw new NotFoundError('House')
    return `${u.label}, ${u.zoneName}`
}

// ---------- Charge settings ----------

export const chargeSettingsSchema = z.object({
    securityAmount: z.string().optional().default(''),
    securityFrequency: z.enum(['monthly', 'quarterly', 'yearly']),
    serviceAmount: z.string().optional().default(''),
    serviceFrequency: z.enum(['monthly', 'quarterly', 'yearly']),
    showEstateTotalsToResidents: z.string().optional().transform(v => v === 'on'),
}).transform((v, ctx) => {
    const amount = (raw: string, path: string) => {
        if (!raw.trim()) return 0
        const kobo = parseNairaToKobo(raw)
        if (kobo === null || kobo > MAX_PAYMENT_KOBO) {
            ctx.addIssue({ code: 'custom', path: [path], message: 'Enter an amount in naira, or leave empty' })
            return 0
        }
        return kobo
    }
    return {
        charges: {
            security_levy: { amountKobo: amount(v.securityAmount, 'securityAmount'), frequency: v.securityFrequency },
            service_charge: { amountKobo: amount(v.serviceAmount, 'serviceAmount'), frequency: v.serviceFrequency },
        },
        showEstateTotalsToResidents: v.showEstateTotalsToResidents,
    }
})

export async function getChargeSettings (actor: Actor, estateId: string) {
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        const access = await getEstateAccess(tx, actor, estateId)
        if (!access.capabilities.has('finance.read') && access.residentUnitIds.length === 0) throw new ForbiddenError()
        const { settings } = await loadSettings(tx, estateId)
        return settings.levies
    })
}

/** How much each house is expected to pay for each charge, and how often. */
export async function updateChargeSettings (actor: Actor, estateId: string, input: z.input<typeof chargeSettingsSchema>): Promise<void> {
    const data = chargeSettingsSchema.parse(input)
    await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'finance.manage')
        const { raw } = await loadSettings(tx, estateId)
        const levies = { ...(raw.levies as Record<string, unknown> ?? {}), ...data }
        const next = { ...raw, levies }
        resolveEstateSettings(next) // validates
        await tx.update(estates).set({ settings: next }).where(eq(estates.id, estateId))
        await recordAudit(tx, { estateId, actorUserId: actor.userId, action: 'finance.charges_updated', details: data })
    })
}

// ---------- Recording ----------

/** Finance staff record a payment received from a house. The house's residents are told in-app. */
export async function recordPayment (actor: Actor, estateId: string, input: z.input<typeof recordPaymentSchema>, now: Date = new Date()): Promise<LevyPayment> {
    const data = recordPaymentSchema.parse(input)
    const coversTo = data.coversTo ?? data.coversFrom
    if (data.paidOn > lagosToday(now)) throw new AppError('The payment date cannot be in the future.')
    if (coversTo < data.coversFrom) throw new AppError('The last month covered must be on or after the first.')
    if (coversTo - data.coversFrom + 1 > MAX_COVER_MONTHS) throw new AppError(`One payment can cover at most ${MAX_COVER_MONTHS} months.`)
    const period = rangeLabel(data.coversFrom, coversTo)
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'finance.manage')
        const house = await unitLabel(tx, estateId, data.unitId)
        const [payment] = await tx.insert(levyPayments).values({
            estateId,
            unitId: data.unitId,
            kind: data.kind,
            amountKobo: data.amount,
            coversFrom: monthDate(data.coversFrom),
            coversTo: monthDate(coversTo),
            period,
            paidOn: data.paidOn,
            method: data.method,
            reference: data.reference,
            payerName: data.payerName,
            note: data.note,
            recordedBy: actor.userId,
        }).returning()
        await recordAudit(tx, {
            estateId, actorUserId: actor.userId, action: 'payment.recorded', entityType: 'levy_payment', entityId: payment.id,
            details: { unit: house, kind: data.kind, amountKobo: data.amount, period },
        })
        await notifyUnitResidents(tx, data.unitId, {
            estateId,
            type: 'payment.recorded',
            title: 'Payment recorded',
            body: `${formatNaira(data.amount)} ${CHARGE_KIND_LABEL[data.kind].toLowerCase()} for ${period} was recorded for ${house}.`,
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

// ---------- Lists and totals ----------

export interface PaymentFilter {
    kind?: string
    q?: string
    from?: string
    to?: string
    includeVoided?: boolean
    limit?: number
}

const isKind = (v: string | undefined): v is ChargeKind => (chargeKind.enumValues as readonly string[]).includes(v ?? '')
const validDate = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)

function filterConditions (estateId: string, f: PaymentFilter) {
    const q = f.q?.trim()
    const from = validDate(f.from)
    const to = validDate(f.to)
    return and(
        eq(levyPayments.estateId, estateId),
        isKind(f.kind) ? eq(levyPayments.kind, f.kind) : undefined,
        from ? gte(levyPayments.paidOn, from) : undefined,
        to ? lte(levyPayments.paidOn, to) : undefined,
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
        const from = validDate(f.from)
        const to = validDate(f.to)
        const inRange = and(
            eq(levyPayments.unitId, units.id),
            isNull(levyPayments.voidedAt),
            from ? gte(levyPayments.paidOn, from) : undefined,
            to ? lte(levyPayments.paidOn, to) : undefined,
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

export interface PeriodTotal { securityKobo: number, serviceKobo: number, totalKobo: number, count: number }
export interface YearTotals extends PeriodTotal { year: number, months: Array<PeriodTotal & { month: number }> }

/**
 * Money received grouped by the year and month it was paid (Lagos dates), newest year first.
 * Every month of each year is present so the tables have no gaps.
 */
function groupByPaidMonth (rows: Array<{ paidOn: string, kind: ChargeKind, amountKobo: number }>): YearTotals[] {
    const empty = (): PeriodTotal => ({ securityKobo: 0, serviceKobo: 0, totalKobo: 0, count: 0 })
    const years = new Map<number, YearTotals>()
    for (const r of rows) {
        const year = Number(r.paidOn.slice(0, 4))
        const m = Number(r.paidOn.slice(5, 7))
        let y = years.get(year)
        if (!y) {
            y = { year, ...empty(), months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...empty() })) }
            years.set(year, y)
        }
        for (const t of [y, y.months[m - 1]]) {
            if (r.kind === 'security_levy') t.securityKobo += r.amountKobo
            else t.serviceKobo += r.amountKobo
            t.totalKobo += r.amountKobo
            t.count++
        }
    }
    return [...years.values()].sort((a, b) => b.year - a.year)
}

/**
 * Total received by the estate per year and month. Finance staff always; residents only when the estate has
 * chosen to share its totals (they never see other houses' payments).
 */
export async function estateCollectionTotals (actor: Actor, estateId: string): Promise<YearTotals[]> {
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        const access = await getEstateAccess(tx, actor, estateId)
        if (!access.capabilities.has('finance.read')) {
            const { settings } = await loadSettings(tx, estateId)
            if (!(access.residentUnitIds.length > 0 && settings.levies.showEstateTotalsToResidents)) throw new ForbiddenError()
        }
        const rows = await tx.select({ paidOn: levyPayments.paidOn, kind: levyPayments.kind, amountKobo: levyPayments.amountKobo })
            .from(levyPayments).where(and(eq(levyPayments.estateId, estateId), isNull(levyPayments.voidedAt)))
        return groupByPaidMonth(rows)
    })
}

// ---------- Who has paid ----------

export type PaymentState = 'paid' | 'part_paid' | 'unpaid' | 'vacant'

export const PAYMENT_STATE_LABEL: Record<PaymentState, string> = { paid: 'Paid', part_paid: 'Part paid', unpaid: 'Not paid', vacant: 'No residents' }

function stateFor (paidKobo: number, expectedKobo: number, occupied: boolean): PaymentState {
    if (expectedKobo > 0 ? paidKobo >= expectedKobo : paidKobo > 0) return 'paid'
    if (!occupied) return 'vacant'
    return paidKobo > 0 ? 'part_paid' : 'unpaid'
}

/** Amount paid towards a period by each unit, from the payments that cover any of its months. */
async function paidTowards (tx: Queryable, estateId: string, kind: ChargeKind, range: { from: number, to: number }, unitIds?: string[]) {
    const rows = await tx.select({ unitId: levyPayments.unitId, amountKobo: levyPayments.amountKobo, coversFrom: levyPayments.coversFrom, coversTo: levyPayments.coversTo })
        .from(levyPayments)
        .where(and(
            eq(levyPayments.estateId, estateId), eq(levyPayments.kind, kind), isNull(levyPayments.voidedAt),
            lte(levyPayments.coversFrom, monthDate(range.to)), gte(levyPayments.coversTo, monthDate(range.from)),
            unitIds ? inArray(levyPayments.unitId, unitIds) : undefined,
        ))
    const paid = new Map<string, number>()
    for (const r of rows) {
        const add = amountTowards({ amountKobo: r.amountKobo, from: parseMonth(r.coversFrom)!, to: parseMonth(r.coversTo)! }, range.from, range.to)
        paid.set(r.unitId, (paid.get(r.unitId) ?? 0) + add)
    }
    return paid
}

function resolvePeriod (frequency: Frequency, periodKey: string | undefined, now: Date) {
    const key = periodKey && periodRange(frequency, periodKey) ? periodKey : periodKeyFor(frequency, lagosMonth(now))
    return { key, range: periodRange(frequency, key)!, label: periodLabel(frequency, key) }
}

/**
 * Every house's position for one charge and period: paid, part paid, not paid, or empty. Includes each house's
 * current residents with their phones, so staff can call or message them, and when they were last reminded.
 */
export async function paymentStatus (actor: Actor, estateId: string, kindInput: string | undefined, periodKey?: string, now: Date = new Date()) {
    const kind: ChargeKind = isKind(kindInput) ? kindInput : 'security_levy'
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'finance.read')
        const { settings } = await loadSettings(tx, estateId)
        const charge = settings.levies.charges[kind]
        const period = resolvePeriod(charge.frequency, periodKey, now)
        const [houseRows, people, reminders] = await inOrder([
            tx.select({ unitId: units.id, unitLabel: units.label, unitType: units.type, zoneName: zones.name }).from(units)
                .innerJoin(zones, eq(zones.id, units.zoneId))
                .where(and(eq(units.estateId, estateId), eq(units.isActive, true)))
                .orderBy(asc(zones.name), asc(units.label)),
            tx.select({ unitId: occupancies.unitId, name: occupancies.name, phone: occupancies.phone, relation: occupancies.relation, isPrimary: occupancies.isPrimary })
                .from(occupancies).where(and(eq(occupancies.estateId, estateId), eq(occupancies.status, 'active')))
                .orderBy(desc(occupancies.isPrimary), asc(occupancies.name)),
            tx.select({ unitId: paymentReminders.unitId, last: sql<Date>`max(${paymentReminders.createdAt})`, count: sql<number>`count(*)::int` })
                .from(paymentReminders)
                .where(and(eq(paymentReminders.estateId, estateId), eq(paymentReminders.kind, kind), eq(paymentReminders.periodKey, period.key)))
                .groupBy(paymentReminders.unitId),
        ])
        const paid = await paidTowards(tx, estateId, kind, period.range)
        const rows = houseRows.map((h) => {
            const residents = people.filter(p => p.unitId === h.unitId)
            const paidKobo = paid.get(h.unitId) ?? 0
            const r = reminders.find(x => x.unitId === h.unitId)
            return {
                ...h,
                residents,
                paidKobo,
                outstandingKobo: Math.max(0, charge.amountKobo - paidKobo),
                state: stateFor(paidKobo, charge.amountKobo, residents.length > 0),
                lastRemindedAt: r ? new Date(r.last) : null,
                reminderCount: r?.count ?? 0,
            }
        })
        const count = (s: PaymentState) => rows.filter(r => r.state === s).length
        return {
            kind,
            frequency: charge.frequency,
            expectedKobo: charge.amountKobo,
            period,
            rows,
            summary: {
                paid: count('paid'),
                partPaid: count('part_paid'),
                unpaid: count('unpaid'),
                vacant: count('vacant'),
                collectedKobo: rows.reduce((t, r) => t + r.paidKobo, 0),
                expectedKobo: charge.amountKobo * rows.filter(r => r.state !== 'vacant').length,
            },
        }
    })
}

export const reminderSchema = z.object({
    kind: z.enum(chargeKind.enumValues),
    periodKey: z.string().min(4).max(10),
    unitIds: z.array(z.uuid()).optional(),
    message: z.string().trim().max(300).optional().transform(v => v || undefined),
})

/**
 * Reminds houses that haven't paid (in full) for a charge and period: an in-app notification for residents with
 * accounts and an SMS to every current resident. With no unitIds, every unpaid or part-paid house is reminded.
 * Houses already reminded for the same charge and period in the last 20 hours are skipped.
 */
export async function sendPaymentReminders (actor: Actor, estateId: string, input: z.input<typeof reminderSchema>, now: Date = new Date()) {
    const data = reminderSchema.parse(input)
    let pending: PendingSms[] = []
    const result = await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'finance.manage')
        const { settings, name: estateName } = await loadSettings(tx, estateId)
        const charge = settings.levies.charges[data.kind]
        const range = periodRange(charge.frequency, data.periodKey)
        if (!range) throw new AppError('Choose a valid period.')
        const label = periodLabel(charge.frequency, data.periodKey)

        const houseRows = await tx.select({ unitId: units.id, unitLabel: units.label, zoneName: zones.name }).from(units)
            .innerJoin(zones, eq(zones.id, units.zoneId))
            .where(and(eq(units.estateId, estateId), eq(units.isActive, true), data.unitIds ? inArray(units.id, data.unitIds) : undefined))
        if (data.unitIds && houseRows.length !== new Set(data.unitIds).size) throw new NotFoundError('House')
        if (houseRows.length === 0) return { reminded: 0, skippedPaid: 0, skippedRecent: 0, recipients: 0 }

        const ids = houseRows.map(h => h.unitId)
        const [people, recent] = await inOrder([
            tx.select({ unitId: occupancies.unitId, userId: occupancies.userId, phone: occupancies.phone }).from(occupancies)
                .where(and(inArray(occupancies.unitId, ids), eq(occupancies.status, 'active'))),
            tx.select({ unitId: paymentReminders.unitId }).from(paymentReminders)
                .where(and(eq(paymentReminders.estateId, estateId), eq(paymentReminders.kind, data.kind), eq(paymentReminders.periodKey, data.periodKey),
                    inArray(paymentReminders.unitId, ids), gte(paymentReminders.createdAt, new Date(now.getTime() - REMINDER_COOLDOWN_HOURS * 3_600_000)))),
        ])
        const paid = await paidTowards(tx, estateId, data.kind, range, ids)
        const recentlyReminded = new Set(recent.map(r => r.unitId))

        let reminded = 0
        let skippedPaid = 0
        let skippedRecent = 0
        let recipients = 0
        const sms: PendingSms[] = []
        for (const h of houseRows) {
            const residents = people.filter(p => p.unitId === h.unitId)
            const paidKobo = paid.get(h.unitId) ?? 0
            const state = stateFor(paidKobo, charge.amountKobo, residents.length > 0)
            if (state === 'paid' || state === 'vacant') { skippedPaid++; continue }
            if (recentlyReminded.has(h.unitId)) { skippedRecent++; continue }
            const outstanding = Math.max(0, charge.amountKobo - paidKobo)
            const owed = outstanding > 0 ? ` (${formatNaira(outstanding)} outstanding)` : ''
            const title = `${CHARGE_KIND_LABEL[data.kind]} for ${label} not yet paid`
            const body = `Your ${CHARGE_KIND_LABEL[data.kind].toLowerCase()} for ${label}${owed} for ${h.unitLabel}, ${h.zoneName} has not been recorded as paid.${data.message ? ` ${data.message}` : ''} If you have paid, send your receipt to the estate office.`
            const withAccounts = [...new Set(residents.map(r => r.userId).filter((u): u is string => u !== null))]
            if (withAccounts.length) {
                await tx.insert(notifications).values(withAccounts.map(userId => ({ estateId, userId, type: 'payment.reminder', title, body, link: '/app' })))
            }
            const phones = [...new Set(residents.map(r => r.phone))]
            for (const to of phones) sms.push({ to, body: `${estateName}: ${body}` })
            await tx.insert(paymentReminders).values({
                estateId, unitId: h.unitId, kind: data.kind, periodKey: data.periodKey, outstandingKobo: outstanding,
                message: data.message, sentBy: actor.userId, recipients: phones.length, createdAt: now,
            })
            reminded++
            recipients += phones.length
        }
        if (reminded > 0) {
            await recordAudit(tx, {
                estateId, actorUserId: actor.userId, action: 'payment.reminders_sent',
                details: { kind: data.kind, period: data.periodKey, houses: reminded, recipients },
            })
        }
        pending = sms
        return { reminded, skippedPaid, skippedRecent, recipients }
    })
    await sendPendingSms(pending)
    return result
}

// ---------- A resident's own house ----------

/**
 * A house's own payment history for its residents (or finance staff): every payment, totals by year and month
 * paid, where it stands for the current period of each charge, and the estate's totals if the estate shares them.
 */
export async function listUnitPayments (actor: Actor, estateId: string, unitId: string, now: Date = new Date()) {
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        const access = await getEstateAccess(tx, actor, estateId)
        if (!access.residentUnitIds.includes(unitId) && !access.capabilities.has('finance.read')) throw new ForbiddenError()
        const { settings } = await loadSettings(tx, estateId)
        const rows = await tx.select().from(levyPayments)
            .where(and(eq(levyPayments.estateId, estateId), eq(levyPayments.unitId, unitId)))
            .orderBy(desc(levyPayments.paidOn), desc(levyPayments.createdAt))
        const valid = rows.filter(r => !r.voidedAt)
        const sum = (k: ChargeKind) => valid.filter(r => r.kind === k).reduce((t, r) => t + r.amountKobo, 0)
        const current = []
        for (const kind of chargeKind.enumValues) {
            const charge = settings.levies.charges[kind]
            const period = resolvePeriod(charge.frequency, undefined, now)
            const paidKobo = (await paidTowards(tx, estateId, kind, period.range, [unitId])).get(unitId) ?? 0
            current.push({
                kind, period, expectedKobo: charge.amountKobo, frequency: charge.frequency, paidKobo,
                outstandingKobo: Math.max(0, charge.amountKobo - paidKobo),
                state: stateFor(paidKobo, charge.amountKobo, true),
            })
        }
        return {
            rows,
            securityKobo: sum('security_levy'),
            serviceKobo: sum('service_charge'),
            byYear: groupByPaidMonth(valid),
            current,
            estateTotalsShared: settings.levies.showEstateTotalsToResidents,
        }
    })
}

/** The years with payments, for pickers. */
export function yearsIn (totals: YearTotals[], now: Date = new Date()): number[] {
    const thisYear = yearOf(lagosMonth(now))
    return [...new Set([thisYear, ...totals.map(t => t.year)])].sort((a, b) => b - a)
}
