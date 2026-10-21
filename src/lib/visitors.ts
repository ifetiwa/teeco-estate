import { and, asc, desc, eq, gt, gte, ilike, inArray, lt, lte, ne, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import { type EstateSettings, resolveEstateSettings } from '@/config/defaults'
import { type Queryable, type Tx, inOrder, withDbContext } from '@/db'
import { blockedVisitors, estates, gateCodeAttempts, memberships, occupancies, units, visitorPasses, visits, zones } from '@/db/schema'
import { type Actor, type EstateAccess, getEstateAccess, requireCapability } from '@/lib/access'
import { recordAudit } from '@/lib/audit'
import { randomDigits } from '@/lib/crypto'
import { AppError, ForbiddenError, NotFoundError, RateLimitError, isUniqueViolation } from '@/lib/errors'
import { formatDateTime, isWithinDailyWindow, parseLagosDateTime, startOfLagosDay } from '@/lib/format'
import { type PendingSms, insertNotifications, notifyUnitResidents, sendPendingSms } from '@/lib/notifications'
import { formatNigerianPhone, normalizeNigerianPhone } from '@/lib/phone'
import { normalizePlate } from '@/lib/residents'

export type VisitorPass = typeof visitorPasses.$inferSelect
export type Visit = typeof visits.$inferSelect

export const PASS_CODE_LENGTH = 6
export const MAX_PASS_WINDOW_DAYS = 31
/** Failed code lookups allowed per guard device in the window before it is locked out. */
export const GATE_MAX_FAILURES = 5
export const GATE_FAILURE_WINDOW_MINUTES = 10

const QR_PREFIX = 'TEECO-PASS'

/** Text encoded in a pass's QR image. The guard's scanner reads it back with parseGateInput(). */
export function passQrPayload (pass: Pick<VisitorPass, 'id' | 'code'>): string {
    return `${QR_PREFIX}:${pass.id}:${pass.code}`
}

export function parseGateInput (raw: string): { passId?: string, code: string } | null {
    const input = raw.trim()
    const qr = new RegExp(`^${QR_PREFIX}:([0-9a-f-]{36}):(\\d{${PASS_CODE_LENGTH}})$`, 'i').exec(input)
    if (qr) return { passId: qr[1].toLowerCase(), code: qr[2] }
    const digits = input.replace(/[\s-]/g, '')
    return new RegExp(`^\\d{${PASS_CODE_LENGTH}}$`).test(digits) ? { code: digits } : null
}

async function loadSettings (tx: Queryable, estateId: string): Promise<{ settings: EstateSettings, gateCount: number }> {
    const [e] = await tx.select({ settings: estates.settings, gateCount: estates.gateCount }).from(estates).where(eq(estates.id, estateId))
    if (!e) throw new NotFoundError('Estate')
    return { settings: resolveEstateSettings(e.settings), gateCount: e.gateCount }
}

function curfewMessage (settings: EstateSettings, at: Date): string | null {
    const c = settings.visitors.curfew
    return c.enabled && isWithinDailyWindow(at, c.start, c.end) ? `Curfew is in force (${c.start} to ${c.end}). Visitors cannot be admitted now.` : null
}

async function findBlock (tx: Queryable, estateId: string, name: string, phone: string | null | undefined) {
    const conds = [sql`lower(${blockedVisitors.name}) = lower(${name.trim()})`]
    if (phone) conds.push(eq(blockedVisitors.phone, phone))
    const [b] = await tx.select().from(blockedVisitors)
        .where(and(eq(blockedVisitors.estateId, estateId), eq(blockedVisitors.isActive, true), or(...conds))).limit(1)
    return b ?? null
}

/** In-app update for the estate's security team (active guards), e.g. an expected visitor or a resident's answer at the gate. */
async function notifyGuards (tx: Queryable, estateId: string, n: { type: string, title: string, body: string }) {
    const guards = await tx.selectDistinct({ userId: memberships.userId }).from(memberships)
        .where(and(eq(memberships.estateId, estateId), eq(memberships.role, 'guard'), eq(memberships.isActive, true)))
    if (guards.length) {
        await insertNotifications(tx, guards.map(g => ({ estateId, userId: g.userId, ...n, link: `/security/${estateId}` })))
    }
}

async function houseLabel (tx: Queryable, unitId: string): Promise<string> {
    const [u] = await tx.select({ label: units.label, zoneName: zones.name }).from(units).innerJoin(zones, eq(zones.id, units.zoneId)).where(eq(units.id, unitId))
    return u ? `${u.label}, ${u.zoneName}` : 'a house'
}

function requireResidentOf (access: EstateAccess, unitId: string) {
    if (!access.residentUnitIds.includes(unitId)) throw new ForbiddenError('Only residents of this house can do that.')
}

// ---------- Residents: passes ----------

const optionalPhone = z.string().optional().transform(v => v?.trim() || undefined)
    .refine(v => !v || normalizeNigerianPhone(v), 'Enter a valid Nigerian phone number')
    .transform(v => (v ? normalizeNigerianPhone(v)! : undefined))
const optionalPlate = z.string().optional().transform(v => (v?.trim() ? normalizePlate(v) : undefined))
    .refine(v => !v || /^[A-Z0-9]{5,10}$/.test(v), 'Enter a valid plate number, e.g. ABC-123DE')

export const createPassSchema = z.object({
    unitId: z.uuid(),
    visitorName: z.string().trim().min(2, 'Enter the visitor\'s name').max(120),
    visitorPhone: optionalPhone,
    purpose: z.string().trim().max(200).default(''),
    vehiclePlate: optionalPlate,
    validFrom: z.string().transform((v, ctx) => parseLagosDateTime(v) ?? (ctx.addIssue({ code: 'custom', message: 'Enter a valid start time' }), z.NEVER)),
    validUntil: z.string().transform((v, ctx) => parseLagosDateTime(v) ?? (ctx.addIssue({ code: 'custom', message: 'Enter a valid end time' }), z.NEVER)),
    usage: z.enum(['single', 'multi']).default('single'),
})

/** A resident pre-approves a visitor. Returns the pass with its 6-digit code. */
export async function createPass (actor: Actor, estateId: string, input: z.input<typeof createPassSchema>, now: Date = new Date()): Promise<VisitorPass> {
    const data = createPassSchema.parse(input)
    if (data.validUntil <= data.validFrom) throw new AppError('The end time must be after the start time.')
    if (data.validUntil <= now) throw new AppError('The end time has already passed.')
    if (data.validFrom < new Date(now.getTime() - 60 * 60_000)) throw new AppError('The start time cannot be in the past.')
    if (data.validUntil.getTime() - data.validFrom.getTime() > MAX_PASS_WINDOW_DAYS * 86_400_000) throw new AppError(`A pass can last at most ${MAX_PASS_WINDOW_DAYS} days.`)

    for (let attempt = 0; attempt < 8; attempt++) {
        try {
            return await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
                const access = await getEstateAccess(tx, actor, estateId)
                requireResidentOf(access, data.unitId)
                const { settings } = await loadSettings(tx, estateId)
                const block = await findBlock(tx, estateId, data.visitorName, data.visitorPhone)
                if (block) throw new AppError('The estate has blocked this visitor. Contact the estate office.')
                const [{ today }] = await tx.select({ today: sql<number>`count(*)::int` }).from(visitorPasses)
                    .where(and(eq(visitorPasses.estateId, estateId), eq(visitorPasses.createdBy, actor.userId), gte(visitorPasses.createdAt, startOfLagosDay(now))))
                if (today >= settings.visitors.maxPassesPerResidentPerDay) {
                    throw new AppError(`You can create up to ${settings.visitors.maxPassesPerResidentPerDay} passes a day in this estate.`)
                }
                // Free up codes of passes whose window has ended
                await tx.update(visitorPasses).set({ status: 'expired' })
                    .where(and(eq(visitorPasses.estateId, estateId), eq(visitorPasses.status, 'active'), lt(visitorPasses.validUntil, now)))
                const [pass] = await tx.insert(visitorPasses).values({
                    estateId,
                    unitId: data.unitId,
                    createdBy: actor.userId,
                    visitorName: data.visitorName,
                    visitorPhone: data.visitorPhone,
                    purpose: data.purpose,
                    vehiclePlate: data.vehiclePlate,
                    code: randomDigits(PASS_CODE_LENGTH),
                    usage: data.usage,
                    validFrom: data.validFrom,
                    validUntil: data.validUntil,
                }).returning()
                await notifyGuards(tx, estateId, {
                    type: 'visitor.expected',
                    title: `Expected visitor: ${pass.visitorName}`,
                    body: `For ${await houseLabel(tx, pass.unitId)}, ${formatDateTime(pass.validFrom)} to ${formatDateTime(pass.validUntil)}${pass.vehiclePlate ? `, vehicle ${pass.vehiclePlate}` : ''}.`,
                })
                return pass
            })
        } catch (e) {
            if (!isUniqueViolation(e, 'visitor_passes_active_code')) throw e
        }
    }
    throw new Error('Could not generate a unique pass code')
}

export async function cancelPass (actor: Actor, estateId: string, passId: string): Promise<void> {
    await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        const [pass] = await tx.select().from(visitorPasses).where(and(eq(visitorPasses.id, passId), eq(visitorPasses.estateId, estateId)))
        if (!pass) throw new NotFoundError('Pass')
        requireResidentOf(await getEstateAccess(tx, actor, estateId), pass.unitId)
        if (pass.status !== 'active') throw new AppError('This pass is no longer active.')
        await tx.update(visitorPasses).set({ status: 'cancelled' }).where(eq(visitorPasses.id, passId))
    })
}

/** Passes and recent visits for a resident's unit. */
export async function listUnitPasses (actor: Actor, estateId: string, unitId: string) {
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        requireResidentOf(await getEstateAccess(tx, actor, estateId), unitId)
        const [passes, recentVisits] = await inOrder([
            tx.select().from(visitorPasses).where(eq(visitorPasses.unitId, unitId)).orderBy(desc(visitorPasses.createdAt)).limit(30),
            tx.select().from(visits).where(eq(visits.unitId, unitId)).orderBy(desc(visits.createdAt)).limit(30),
        ])
        return { passes, visits: recentVisits }
    })
}

export async function getPassForResident (actor: Actor, estateId: string, passId: string): Promise<VisitorPass> {
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        const [pass] = await tx.select().from(visitorPasses).where(and(eq(visitorPasses.id, passId), eq(visitorPasses.estateId, estateId)))
        if (!pass) throw new NotFoundError('Pass')
        requireResidentOf(await getEstateAccess(tx, actor, estateId), pass.unitId)
        return pass
    })
}

/** Effective state of a pass at a moment, including time-based expiry. */
export function passState (pass: Pick<VisitorPass, 'status' | 'usage' | 'usesCount' | 'validFrom' | 'validUntil'>, now: Date = new Date()):
    'active' | 'not_yet_valid' | 'expired' | 'used' | 'cancelled' {
    if (pass.status === 'cancelled') return 'cancelled'
    if (pass.status === 'used' || (pass.usage === 'single' && pass.usesCount > 0)) return 'used'
    if (pass.status === 'expired' || now >= pass.validUntil) return 'expired'
    if (now < pass.validFrom) return 'not_yet_valid'
    return 'active'
}

// ---------- Guards: verify, check in and out ----------

export interface GateHit {
    ok: true
    pass: VisitorPass
    unitLabel: string
    zoneName: string
    residentName: string | null
}
export interface GateMiss {
    ok: false
    reason: 'invalid_format' | 'not_found' | 'wrong_estate' | 'expired' | 'not_yet_valid' | 'used' | 'cancelled' | 'blocked' | 'curfew'
    message: string
    pass?: VisitorPass
}

async function recordAttempt (tx: Queryable, estateId: string, deviceId: string, userId: string, success: boolean) {
    await tx.insert(gateCodeAttempts).values({ estateId, deviceId, userId, success })
}

async function assertNotLockedOut (tx: Queryable, estateId: string, deviceId: string, now: Date) {
    const since = new Date(now.getTime() - GATE_FAILURE_WINDOW_MINUTES * 60_000)
    const [{ failures }] = await tx.select({ failures: sql<number>`count(*)::int` }).from(gateCodeAttempts)
        .where(and(eq(gateCodeAttempts.estateId, estateId), eq(gateCodeAttempts.deviceId, deviceId), eq(gateCodeAttempts.success, false), gt(gateCodeAttempts.createdAt, since)))
    if (failures >= GATE_MAX_FAILURES) {
        throw new RateLimitError(`Too many wrong codes on this device. Wait ${GATE_FAILURE_WINDOW_MINUTES} minutes or call the estate office.`)
    }
}

/** Does a code or pass exist in another estate? Used only to give the guard a clear "wrong estate" message. */
async function existsInOtherEstate (estateId: string, parsed: { passId?: string, code: string }): Promise<boolean> {
    return withDbContext({ system: true }, async (tx) => {
        const rows = await tx.select({ id: visitorPasses.id }).from(visitorPasses).where(and(
            ne(visitorPasses.estateId, estateId),
            parsed.passId ? eq(visitorPasses.id, parsed.passId) : and(eq(visitorPasses.code, parsed.code), eq(visitorPasses.status, 'active')),
        )).limit(1)
        return rows.length > 0
    })
}

/**
 * Guard enters or scans a code. Every lookup counts toward the device's rate limit; failures lock the device
 * after GATE_MAX_FAILURES in GATE_FAILURE_WINDOW_MINUTES.
 */
export async function verifyGateCode (actor: Actor, estateId: string, rawInput: string, deviceId: string, now: Date = new Date()): Promise<GateHit | GateMiss> {
    if (!deviceId || deviceId.length < 8) throw new AppError('This device is not registered for gate use. Reload the page.')
    const parsed = parseGateInput(rawInput)
    const result = await withDbContext({ estateId, userId: actor.userId }, async (tx): Promise<GateHit | GateMiss | { lookupOther: true }> => {
        await requireCapability(tx, actor, estateId, 'gate.operate')
        await assertNotLockedOut(tx, estateId, deviceId, now)
        if (!parsed) {
            await recordAttempt(tx, estateId, deviceId, actor.userId, false)
            return { ok: false, reason: 'invalid_format', message: `Codes are ${PASS_CODE_LENGTH} digits. Check the number and try again.` }
        }
        const [pass] = await tx.select().from(visitorPasses).where(and(
            eq(visitorPasses.estateId, estateId),
            parsed.passId ? eq(visitorPasses.id, parsed.passId) : eq(visitorPasses.code, parsed.code),
            parsed.passId ? eq(visitorPasses.code, parsed.code) : undefined,
        )).orderBy(desc(visitorPasses.createdAt)).limit(1)
        if (!pass) {
            await recordAttempt(tx, estateId, deviceId, actor.userId, false)
            return { lookupOther: true }
        }
        await recordAttempt(tx, estateId, deviceId, actor.userId, true)
        const state = passState(pass, now)
        const messages: Record<string, string> = {
            cancelled: 'This pass was cancelled by the resident.',
            used: 'This pass has already been used.',
            expired: `This pass expired at ${formatDateTime(pass.validUntil)}.`,
            not_yet_valid: `This pass is not valid until ${formatDateTime(pass.validFrom)}.`,
        }
        if (state !== 'active') return { ok: false, reason: state, message: messages[state], pass }
        const { settings } = await loadSettings(tx, estateId)
        const block = await findBlock(tx, estateId, pass.visitorName, pass.visitorPhone)
        if (block) return { ok: false, reason: 'blocked', message: `Blocked by the estate: ${block.reason}`, pass }
        const curfew = curfewMessage(settings, now)
        if (curfew) return { ok: false, reason: 'curfew', message: curfew, pass }
        const [where] = await tx.select({ unitLabel: units.label, zoneName: zones.name }).from(units)
            .innerJoin(zones, eq(zones.id, units.zoneId)).where(eq(units.id, pass.unitId))
        const [primary] = await tx.select({ name: occupancies.name }).from(occupancies)
            .where(and(eq(occupancies.unitId, pass.unitId), eq(occupancies.status, 'active'))).orderBy(desc(occupancies.isPrimary)).limit(1)
        return { ok: true, pass, unitLabel: where.unitLabel, zoneName: where.zoneName, residentName: primary?.name ?? null }
    })
    if ('lookupOther' in result) {
        return parsed && await existsInOtherEstate(estateId, parsed)
            ? { ok: false, reason: 'wrong_estate', message: 'This code is for a different estate. It cannot be used here.' }
            : { ok: false, reason: 'not_found', message: 'No pass matches this code. Check the number with the visitor.' }
    }
    return result
}

async function requireGateNumber (tx: Queryable, estateId: string, gate: number): Promise<number> {
    const { gateCount } = await loadSettings(tx, estateId)
    const g = Math.trunc(Number(gate) || 1)
    if (g < 1 || g > gateCount) throw new AppError(`This estate has ${gateCount} gate${gateCount === 1 ? '' : 's'}.`)
    return g
}

async function notifyAfter<T> (estateId: string, actor: Actor, fn: (tx: Tx, sms: PendingSms[]) => Promise<T>): Promise<T> {
    const sms: PendingSms[] = []
    const result = await withDbContext({ estateId, userId: actor.userId }, tx => fn(tx, sms))
    await sendPendingSms(sms)
    return result
}

/** Guard admits a visitor with a valid pass. Re-checks the pass under a row lock so a single-use pass admits once. */
export async function checkInWithPass (actor: Actor, estateId: string, passId: string, gate: number, now: Date = new Date()): Promise<Visit> {
    return notifyAfter(estateId, actor, async (tx) => {
        await requireCapability(tx, actor, estateId, 'gate.operate')
        const g = await requireGateNumber(tx, estateId, gate)
        const [pass] = await tx.select().from(visitorPasses)
            .where(and(eq(visitorPasses.id, passId), eq(visitorPasses.estateId, estateId))).for('update')
        if (!pass) throw new NotFoundError('Pass')
        const state = passState(pass, now)
        if (state !== 'active') throw new AppError(state === 'used' ? 'This pass has already been used.' : `This pass is ${state.replace(/_/g, ' ')}.`)
        const { settings } = await loadSettings(tx, estateId)
        const curfew = curfewMessage(settings, now)
        if (curfew) throw new AppError(curfew)
        if (await findBlock(tx, estateId, pass.visitorName, pass.visitorPhone)) throw new AppError('This visitor is blocked by the estate.')
        await tx.update(visitorPasses).set({
            usesCount: pass.usesCount + 1,
            status: pass.usage === 'single' ? 'used' : 'active',
        }).where(eq(visitorPasses.id, pass.id))
        const [visit] = await tx.insert(visits).values({
            estateId, unitId: pass.unitId, passId: pass.id, kind: 'pass', status: 'checked_in',
            visitorName: pass.visitorName, visitorPhone: pass.visitorPhone, vehiclePlate: pass.vehiclePlate, purpose: pass.purpose,
            gate: g, loggedBy: actor.userId, checkedInAt: now, checkedInBy: actor.userId,
        }).returning()
        await notifyUnitResidents(tx, pass.unitId, {
            estateId, type: 'visitor.arrived', title: `${pass.visitorName} has arrived`, body: `Checked in at gate ${g} at ${formatDateTime(now)}.`,
        })
        return visit
    })
}

/** Guard turns a pass holder away; recorded in the visitor log. */
export async function denyPassEntry (actor: Actor, estateId: string, passId: string, reason: string, gate: number): Promise<Visit> {
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'gate.operate')
        const g = await requireGateNumber(tx, estateId, gate)
        const [pass] = await tx.select().from(visitorPasses).where(and(eq(visitorPasses.id, passId), eq(visitorPasses.estateId, estateId)))
        if (!pass) throw new NotFoundError('Pass')
        const [visit] = await tx.insert(visits).values({
            estateId, unitId: pass.unitId, passId: pass.id, kind: 'pass', status: 'denied', note: reason.trim().slice(0, 300) || 'Denied at gate',
            visitorName: pass.visitorName, visitorPhone: pass.visitorPhone, vehiclePlate: pass.vehiclePlate, purpose: pass.purpose,
            gate: g, loggedBy: actor.userId,
        }).returning()
        return visit
    })
}

export const walkInSchema = z.object({
    unitId: z.uuid('Choose the house the visitor is going to'),
    visitorName: z.string().trim().min(2, 'Enter the visitor\'s name').max(120),
    visitorPhone: optionalPhone,
    purpose: z.string().trim().max(200).default(''),
    vehiclePlate: optionalPlate,
    gate: z.coerce.number().int().min(1).default(1),
})

/** Guard logs a visitor without a pass; the unit's residents are asked to approve by in-app notice and SMS. */
export async function logWalkIn (actor: Actor, estateId: string, input: z.input<typeof walkInSchema>, now: Date = new Date()): Promise<Visit> {
    const data = walkInSchema.parse(input)
    return notifyAfter(estateId, actor, async (tx, sms) => {
        await requireCapability(tx, actor, estateId, 'gate.operate')
        const g = await requireGateNumber(tx, estateId, data.gate)
        const [unit] = await tx.select({ id: units.id, label: units.label, isActive: units.isActive }).from(units)
            .where(and(eq(units.id, data.unitId), eq(units.estateId, estateId)))
        if (!unit || !unit.isActive) throw new NotFoundError('Unit')
        const { settings } = await loadSettings(tx, estateId)
        const curfew = curfewMessage(settings, now)
        if (curfew) throw new AppError(curfew)
        const block = await findBlock(tx, estateId, data.visitorName, data.visitorPhone)
        if (block) throw new AppError(`This visitor is blocked by the estate: ${block.reason}`)
        const [{ residents }] = await tx.select({ residents: sql<number>`count(*)::int` }).from(occupancies)
            .where(and(eq(occupancies.unitId, unit.id), eq(occupancies.status, 'active')))
        if (residents === 0) throw new AppError('Nobody is registered at this house. Call the estate office.')
        const [visit] = await tx.insert(visits).values({
            estateId, unitId: unit.id, kind: 'walk_in', status: 'awaiting_resident',
            visitorName: data.visitorName, visitorPhone: data.visitorPhone, vehiclePlate: data.vehiclePlate, purpose: data.purpose,
            gate: g, loggedBy: actor.userId,
        }).returning()
        const who = data.visitorPhone ? `${data.visitorName} (${formatNigerianPhone(data.visitorPhone)})` : data.visitorName
        sms.push(...await notifyUnitResidents(tx, unit.id, {
            estateId, type: 'visitor.walk_in_request', title: `${data.visitorName} is at gate ${g}`,
            body: `${who} wants to visit${data.purpose ? `: ${data.purpose}` : ''}. Open the app to approve or decline.`,
            link: '/app',
        }, { sms: true }))
        return visit
    })
}

/** A resident of the unit approves or declines a walk-in visitor. */
export async function decideWalkIn (actor: Actor, estateId: string, visitId: string, approve: boolean, note?: string): Promise<Visit> {
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        const [visit] = await tx.select().from(visits).where(and(eq(visits.id, visitId), eq(visits.estateId, estateId))).for('update')
        if (!visit) throw new NotFoundError('Visitor')
        requireResidentOf(await getEstateAccess(tx, actor, estateId), visit.unitId)
        if (visit.status !== 'awaiting_resident') throw new AppError('This request has already been answered.')
        const [row] = await tx.update(visits).set({
            status: approve ? 'approved' : 'declined', decidedBy: actor.userId, decidedAt: new Date(), note: note?.trim().slice(0, 300) || null,
        }).where(eq(visits.id, visitId)).returning()
        await notifyGuards(tx, estateId, {
            type: approve ? 'visitor.walk_in_approved' : 'visitor.walk_in_declined',
            title: approve ? `Let in: ${row.visitorName}` : `Do not admit: ${row.visitorName}`,
            body: `${approve ? 'Approved' : 'Declined'} by the resident of ${await houseLabel(tx, row.unitId)} (gate ${row.gate}).${row.note ? ` ${row.note}` : ''}`,
        })
        return row
    })
}

export async function checkInApprovedWalkIn (actor: Actor, estateId: string, visitId: string, now: Date = new Date()): Promise<Visit> {
    return notifyAfter(estateId, actor, async (tx) => {
        await requireCapability(tx, actor, estateId, 'gate.operate')
        const [visit] = await tx.select().from(visits).where(and(eq(visits.id, visitId), eq(visits.estateId, estateId))).for('update')
        if (!visit) throw new NotFoundError('Visitor')
        if (visit.status !== 'approved') throw new AppError(visit.status === 'awaiting_resident' ? 'The resident has not answered yet.' : 'The resident did not approve this visit.')
        const { settings } = await loadSettings(tx, estateId)
        const curfew = curfewMessage(settings, now)
        if (curfew) throw new AppError(curfew)
        const [row] = await tx.update(visits).set({ status: 'checked_in', checkedInAt: now, checkedInBy: actor.userId }).where(eq(visits.id, visitId)).returning()
        await notifyUnitResidents(tx, visit.unitId, {
            estateId, type: 'visitor.arrived', title: `${visit.visitorName} has arrived`, body: `Checked in at gate ${visit.gate} at ${formatDateTime(now)}.`,
        })
        return row
    })
}

export async function checkOutVisit (actor: Actor, estateId: string, visitId: string, now: Date = new Date()): Promise<Visit> {
    return notifyAfter(estateId, actor, async (tx) => {
        await requireCapability(tx, actor, estateId, 'gate.operate')
        const [visit] = await tx.select().from(visits).where(and(eq(visits.id, visitId), eq(visits.estateId, estateId))).for('update')
        if (!visit) throw new NotFoundError('Visitor')
        if (visit.status !== 'checked_in') throw new AppError('This visitor is not checked in.')
        const [row] = await tx.update(visits).set({ status: 'checked_out', checkedOutAt: now, checkedOutBy: actor.userId }).where(eq(visits.id, visitId)).returning()
        await notifyUnitResidents(tx, visit.unitId, {
            estateId, type: 'visitor.left', title: `${visit.visitorName} has left`, body: `Checked out at ${formatDateTime(now)}.`,
        })
        return row
    })
}

/** What the guard screen needs: walk-ins waiting, approved/declined, and who is inside. */
export async function getGateBoard (actor: Actor, estateId: string, now: Date = new Date()) {
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'gate.operate')
        const since = new Date(now.getTime() - 12 * 3_600_000)
        const rows = await tx.select({ visit: visits, unitLabel: units.label, zoneName: zones.name }).from(visits)
            .innerJoin(units, eq(units.id, visits.unitId)).innerJoin(zones, eq(zones.id, units.zoneId))
            .where(and(eq(visits.estateId, estateId), or(
                eq(visits.status, 'checked_in'),
                and(inArray(visits.status, ['awaiting_resident', 'approved', 'declined']), gte(visits.createdAt, since)),
            )))
            .orderBy(asc(visits.createdAt))
        const { gateCount } = await loadSettings(tx, estateId)
        return {
            gateCount,
            waiting: rows.filter(r => r.visit.status === 'awaiting_resident'),
            approved: rows.filter(r => r.visit.status === 'approved'),
            declined: rows.filter(r => r.visit.status === 'declined'),
            inside: rows.filter(r => r.visit.status === 'checked_in'),
        }
    })
}

/** Walk-in requests waiting for this resident's answer, across their units in the estate. */
export async function listWalkInRequestsForResident (actor: Actor, estateId: string) {
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        const access = await getEstateAccess(tx, actor, estateId)
        if (access.residentUnitIds.length === 0) return []
        return tx.select().from(visits)
            .where(and(eq(visits.estateId, estateId), inArray(visits.unitId, access.residentUnitIds), eq(visits.status, 'awaiting_resident')))
            .orderBy(asc(visits.createdAt))
    })
}

// ---------- Estate admin: rules, blocklist, log ----------

export const visitorRulesSchema = z.object({
    maxPassesPerResidentPerDay: z.coerce.number().int().min(1, 'At least 1').max(100),
    curfewEnabled: z.string().optional().transform(v => v === 'on'),
    curfewStart: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM'),
    curfewEnd: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM'),
})

export async function updateVisitorRules (actor: Actor, estateId: string, input: z.input<typeof visitorRulesSchema>) {
    const data = visitorRulesSchema.parse(input)
    await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'estate.manage')
        const [e] = await tx.select({ settings: estates.settings }).from(estates).where(eq(estates.id, estateId))
        const current = (e?.settings ?? {}) as Record<string, unknown>
        const visitorsOverride = { ...(current.visitors as Record<string, unknown> ?? {}),
            maxPassesPerResidentPerDay: data.maxPassesPerResidentPerDay,
            curfew: { enabled: data.curfewEnabled, start: data.curfewStart, end: data.curfewEnd } }
        const next = { ...current, visitors: visitorsOverride }
        resolveEstateSettings(next) // validates
        await tx.update(estates).set({ settings: next }).where(eq(estates.id, estateId))
        await recordAudit(tx, { estateId, actorUserId: actor.userId, action: 'visitors.rules_updated', details: visitorsOverride })
    })
}

export async function getVisitorRules (actor: Actor, estateId: string) {
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'visitors.read')
        return (await loadSettings(tx, estateId)).settings.visitors
    })
}

export const blockSchema = z.object({
    name: z.string().trim().max(120).optional().transform(v => v || undefined),
    phone: optionalPhone,
    reason: z.string().trim().min(3, 'Give a reason').max(300),
}).refine(v => v.name || v.phone, { message: 'Enter a name or a phone number', path: ['name'] })

export async function blockVisitor (actor: Actor, estateId: string, input: z.input<typeof blockSchema>) {
    const data = blockSchema.parse(input)
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'estate.manage')
        const [row] = await tx.insert(blockedVisitors).values({ estateId, name: data.name, phone: data.phone, reason: data.reason, createdBy: actor.userId }).returning()
        await recordAudit(tx, { estateId, actorUserId: actor.userId, action: 'visitors.blocked', entityType: 'blocked_visitor', entityId: row.id, details: { name: data.name, phone: data.phone } })
        return row
    })
}

export async function unblockVisitor (actor: Actor, estateId: string, blockId: string) {
    await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'estate.manage')
        const res = await tx.update(blockedVisitors).set({ isActive: false })
            .where(and(eq(blockedVisitors.id, blockId), eq(blockedVisitors.estateId, estateId))).returning({ id: blockedVisitors.id })
        if (!res.length) throw new NotFoundError('Blocked visitor')
    })
}

export async function listBlockedVisitors (actor: Actor, estateId: string) {
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'visitors.read')
        return tx.select().from(blockedVisitors)
            .where(and(eq(blockedVisitors.estateId, estateId), eq(blockedVisitors.isActive, true))).orderBy(desc(blockedVisitors.createdAt))
    })
}

export interface VisitorLogFilter { q?: string, from?: string, to?: string, limit?: number }

/** Full visitor log with search; dates are Lagos calendar days (YYYY-MM-DD). */
export async function listVisitorLog (actor: Actor, estateId: string, f: VisitorLogFilter = {}) {
    const q = f.q?.trim()
    const phone = q ? normalizeNigerianPhone(q) : null
    const from = f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from) ? parseLagosDateTime(`${f.from}T00:00`) : null
    const toStart = f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to) ? parseLagosDateTime(`${f.to}T00:00`) : null
    const to = toStart ? new Date(toStart.getTime() + 86_400_000) : null
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'visitors.read')
        return tx.select({ visit: visits, unitLabel: units.label, zoneName: zones.name }).from(visits)
            .innerJoin(units, eq(units.id, visits.unitId)).innerJoin(zones, eq(zones.id, units.zoneId))
            .where(and(
                eq(visits.estateId, estateId),
                from ? gte(visits.createdAt, from) : undefined,
                to ? lte(visits.createdAt, to) : undefined,
                q ? or(ilike(visits.visitorName, `%${q}%`), ilike(units.label, `%${q}%`), ilike(zones.name, `%${q}%`),
                    ilike(visits.vehiclePlate, `%${normalizePlate(q)}%`), phone ? eq(visits.visitorPhone, phone) : undefined) : undefined,
            ))
            .orderBy(desc(visits.createdAt))
            .limit(Math.min(f.limit ?? 500, 5000))
    })
}

const STATUS_LABEL: Record<string, string> = {
    awaiting_resident: 'Waiting for resident', approved: 'Approved', declined: 'Declined by resident', denied: 'Denied at gate',
    checked_in: 'Inside', checked_out: 'Left', cancelled: 'Cancelled',
}
export function visitStatusLabel (s: string): string {
    return STATUS_LABEL[s] ?? s
}

function csvCell (v: unknown): string {
    let s = v === null || v === undefined ? '' : String(v)
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}` // stop spreadsheet formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function exportVisitorLogCsv (actor: Actor, estateId: string, f: VisitorLogFilter = {}): Promise<string> {
    const rows = await listVisitorLog(actor, estateId, { ...f, limit: 5000 })
    await withDbContext({ estateId, userId: actor.userId }, tx =>
        recordAudit(tx, { estateId, actorUserId: actor.userId, action: 'export.visitor_log', details: { rows: rows.length, ...f } }))
    const header = ['Date', 'Visitor', 'Phone', 'Vehicle', 'House', 'Street/Block', 'Type', 'Status', 'Gate', 'Checked in', 'Checked out', 'Purpose', 'Note']
    const lines = rows.map(({ visit: v, unitLabel, zoneName }) => [
        formatDateTime(v.createdAt), v.visitorName, v.visitorPhone ? formatNigerianPhone(v.visitorPhone) : '', v.vehiclePlate ?? '', unitLabel, zoneName,
        v.kind === 'pass' ? 'Pass' : 'Walk-in', visitStatusLabel(v.status), v.gate,
        v.checkedInAt ? formatDateTime(v.checkedInAt) : '', v.checkedOutAt ? formatDateTime(v.checkedOutAt) : '', v.purpose, v.note ?? '',
    ].map(csvCell).join(','))
    return [header.join(','), ...lines].join('\r\n') + '\r\n'
}
