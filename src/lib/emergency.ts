import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { EMERGENCY_LINES, MAX_ALERTS_PER_USER_PER_HOUR, NEAREST_STATIONS_SHOWN } from '@/config/emergency'
import { type Queryable, getDb, inOrder, withDbContext } from '@/db'
import { distressAlerts, estates, memberships, notifications, occupancies, policeStations, units, users, zones } from '@/db/schema'
import { type Actor, getEstateAccess, requireCapability, requirePlatformAdmin } from '@/lib/access'
import { formatAddress } from '@/lib/address'
import { recordAudit } from '@/lib/audit'
import { AppError, ForbiddenError, NotFoundError, RateLimitError, isUniqueViolation } from '@/lib/errors'
import { formatTime } from '@/lib/format'
import { type PendingSms, sendPendingSms } from '@/lib/notifications'
import { formatNigerianPhone } from '@/lib/phone'

export type DistressAlert = typeof distressAlerts.$inferSelect
export type PoliceStation = typeof policeStations.$inferSelect

export const DISTRESS_STATUS_LABEL: Record<DistressAlert['status'], string> = {
    active: 'Active',
    acknowledged: 'Security responding',
    resolved: 'Resolved',
    false_alarm: 'Cancelled (false alarm)',
}

// ---------- Geography ----------

/** Rough bounding box of Nigeria; a GPS fix outside it is ignored as bogus. */
function inNigeria (lat: number, lng: number): boolean {
    return lat >= 4 && lat <= 14 && lng >= 2.5 && lng <= 15
}

/** Great-circle distance in km. */
export function distanceKm (a: { lat: number, lng: number }, b: { lat: number, lng: number }): number {
    const rad = (d: number) => d * Math.PI / 180
    const dLat = rad(b.lat - a.lat)
    const dLng = rad(b.lng - a.lng)
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function googleMapsLink (lat: number, lng: number): string {
    return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`
}

export function googleMapsSearchLink (address: string): string {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

/** Phone numbers that can be dialled: digits with an optional leading +, e.g. 112, 08031234567, +2349012345678. */
export function normalizeDialNumber (raw: string): string | null {
    const v = raw.trim().replace(/[\s\-().]/g, '')
    return /^\+?\d{3,15}$/.test(v) ? v : null
}

export function formatDialNumber (n: string): string {
    return formatNigerianPhone(n)
}

// ---------- Police stations (platform-wide) ----------

const coordinate = (min: number, max: number, what: string) => z.coerce.number({ message: `Enter the ${what}` })
    .refine(v => Number.isFinite(v) && v >= min && v <= max, `Enter a valid ${what}`)

const dialNumber = z.string().refine(v => normalizeDialNumber(v), 'Enter a phone number, e.g. 08031234567')
    .transform(v => normalizeDialNumber(v)!)

export const policeStationSchema = z.object({
    name: z.string().trim().min(3, 'Enter the station name').max(120),
    area: z.string().trim().max(80).default(''),
    address: z.string().trim().max(200).default(''),
    phone: dialNumber,
    altPhone: z.string().optional().transform(v => v?.trim() || undefined)
        .refine(v => !v || normalizeDialNumber(v), 'Enter a valid phone number')
        .transform(v => (v ? normalizeDialNumber(v)! : undefined)),
    latitude: coordinate(4, 14, 'latitude'),
    longitude: coordinate(2.5, 15, 'longitude'),
})

export async function addPoliceStation (actor: Actor, input: z.input<typeof policeStationSchema>): Promise<PoliceStation> {
    requirePlatformAdmin(actor)
    const data = policeStationSchema.parse(input)
    const [row] = await getDb().insert(policeStations).values(data).returning()
    return row
}

export async function setPoliceStationActive (actor: Actor, stationId: string, isActive: boolean): Promise<void> {
    requirePlatformAdmin(actor)
    await getDb().update(policeStations).set({ isActive }).where(eq(policeStations.id, stationId))
}

export async function listPoliceStations (actor: Actor): Promise<PoliceStation[]> {
    requirePlatformAdmin(actor)
    return getDb().select().from(policeStations).orderBy(desc(policeStations.isActive), asc(policeStations.name))
}

/** Active stations closest to a point, nearest first. */
export async function nearestPoliceStations (lat: number, lng: number, limit: number = NEAREST_STATIONS_SHOWN) {
    const all = await getDb().select().from(policeStations).where(eq(policeStations.isActive, true))
    return all
        .map(s => ({ ...s, distanceKm: distanceKm({ lat, lng }, { lat: s.latitude, lng: s.longitude }) }))
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, limit)
}

// ---------- Estate location ----------

export const estateLocationSchema = z.object({
    latitude: z.string().trim().optional().default(''),
    longitude: z.string().trim().optional().default(''),
}).transform((v, ctx) => {
    if (!v.latitude && !v.longitude) return { latitude: null, longitude: null }
    const lat = Number(v.latitude)
    const lng = Number(v.longitude)
    if (!v.latitude || !v.longitude || !Number.isFinite(lat) || !Number.isFinite(lng) || !inNigeria(lat, lng)) {
        ctx.addIssue({ code: 'custom', path: ['latitude'], message: 'Enter both numbers for a place in Nigeria, e.g. 9.0579 and 7.4951' })
        return z.NEVER
    }
    return { latitude: lat, longitude: lng }
})

/** The estate's map position, used for alerts sent without a GPS fix. */
export async function setEstateLocation (actor: Actor, estateId: string, input: z.input<typeof estateLocationSchema>): Promise<void> {
    const data = estateLocationSchema.parse(input)
    await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'estate.manage')
        await tx.update(estates).set(data).where(eq(estates.id, estateId))
    })
}

// ---------- Distress alerts ----------

export const raiseDistressSchema = z.object({
    unitId: z.uuid(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    accuracy: z.number().optional(),
})

async function alertContext (tx: Queryable, estateId: string, unitId: string) {
    const [row] = await tx.select({
        unitLabel: units.label, zoneName: zones.name,
        estateName: estates.name, district: estates.district, city: estates.city, state: estates.state,
        estateLat: estates.latitude, estateLng: estates.longitude,
    }).from(units)
        .innerJoin(zones, eq(zones.id, units.zoneId)).innerJoin(estates, eq(estates.id, units.estateId))
        .where(and(eq(units.id, unitId), eq(units.estateId, estateId)))
    if (!row) throw new NotFoundError('House')
    const address = formatAddress({ houseOrBlock: row.unitLabel, street: row.zoneName, estate: row.estateName, district: row.district || undefined, city: row.city, state: row.state })
    return { ...row, house: `${row.unitLabel}, ${row.zoneName}`, address }
}

/** Where to send people: the GPS fix if there is one, else the estate's own position. */
export function alertPosition (alert: Pick<DistressAlert, 'latitude' | 'longitude'>): { lat: number, lng: number } | null {
    return alert.latitude !== null && alert.longitude !== null ? { lat: alert.latitude, lng: alert.longitude } : null
}

interface Recipient { userId: string | null, phone: string, isStaff: boolean }

/** Everyone in the estate who should hear about an alert: active staff, then current residents (deduplicated by phone). */
async function estateRecipients (tx: Queryable, estateId: string): Promise<Recipient[]> {
    const [staff, residents] = await inOrder([
        tx.selectDistinct({ userId: users.id, phone: users.phone }).from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(and(eq(memberships.estateId, estateId), eq(memberships.isActive, true))),
        tx.select({ userId: occupancies.userId, phone: occupancies.phone }).from(occupancies)
            .where(and(eq(occupancies.estateId, estateId), eq(occupancies.status, 'active'))),
    ])
    const byPhone = new Map<string, Recipient>()
    for (const s of staff) byPhone.set(s.phone, { userId: s.userId, phone: s.phone, isStaff: true })
    for (const r of residents) if (!byPhone.has(r.phone)) byPhone.set(r.phone, { userId: r.userId, phone: r.phone, isStaff: false })
    return [...byPhone.values()]
}

async function notifyInApp (tx: Queryable, estateId: string, recipients: Recipient[], n: { type: string, title: string, body: string, staffLink: string, residentLink: string }) {
    const seen = new Set<string>()
    const rows = []
    for (const r of recipients) {
        if (!r.userId || seen.has(r.userId)) continue
        seen.add(r.userId)
        rows.push({ estateId, userId: r.userId, type: n.type, title: n.title, body: n.body, link: r.isStaff ? n.staffLink : n.residentLink })
    }
    if (rows.length) await tx.insert(notifications).values(rows)
}

/**
 * A resident presses the emergency button. Every staff member and resident of the estate is told in-app and by SMS;
 * guards and estate staff get the house, address, the caller's phone and a Google Maps link to the GPS position.
 * Pressing again while an alert for the house is open returns that alert instead of texting everyone again.
 */
export async function raiseDistress (actor: Actor, estateId: string, input: z.input<typeof raiseDistressSchema>, now: Date = new Date()): Promise<{ alert: DistressAlert, reused: boolean }> {
    const data = raiseDistressSchema.parse(input)
    let pending: PendingSms[] = []
    const result = await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        const access = await getEstateAccess(tx, actor, estateId)
        if (!access.residentUnitIds.includes(data.unitId)) throw new ForbiddenError('Only residents of this house can raise an alert for it.')

        const [open] = await tx.select().from(distressAlerts)
            .where(and(eq(distressAlerts.unitId, data.unitId), inArray(distressAlerts.status, ['active', 'acknowledged'])))
        if (open) return { alert: open, reused: true }

        const [{ recent }] = await tx.select({ recent: sql<number>`count(*)::int` }).from(distressAlerts)
            .where(and(eq(distressAlerts.raisedBy, actor.userId), gte(distressAlerts.createdAt, new Date(now.getTime() - 60 * 60_000))))
        if (recent >= MAX_ALERTS_PER_USER_PER_HOUR) throw new RateLimitError('You have raised several alerts in the last hour. Call 112 or the estate gate directly.')

        const ctx = await alertContext(tx, estateId, data.unitId)
        const gps = data.latitude !== undefined && data.longitude !== undefined && Number.isFinite(data.latitude) && Number.isFinite(data.longitude) && inNigeria(data.latitude, data.longitude)
        const position = gps
            ? { latitude: data.latitude!, longitude: data.longitude!, locationSource: 'gps' as const }
            : ctx.estateLat !== null && ctx.estateLng !== null
                ? { latitude: ctx.estateLat, longitude: ctx.estateLng, locationSource: 'estate' as const }
                : { latitude: null, longitude: null, locationSource: 'none' as const }

        const [me] = await tx.select({ name: users.name, phone: users.phone }).from(users).where(eq(users.id, actor.userId))
        const recipients = (await estateRecipients(tx, estateId)).filter(r => r.userId !== actor.userId && r.phone !== me.phone)

        let alert: DistressAlert
        try {
            [alert] = await tx.insert(distressAlerts).values({
                estateId,
                unitId: data.unitId,
                raisedBy: actor.userId,
                ...position,
                accuracyMeters: gps && data.accuracy !== undefined && Number.isFinite(data.accuracy) ? Math.round(data.accuracy) : null,
                notifiedCount: recipients.length,
                createdAt: now,
            }).returning()
        } catch (e) {
            // Another household member pressed at the same moment
            if (!isUniqueViolation(e, 'distress_alerts_one_open_per_unit')) throw e
            const [other] = await tx.select().from(distressAlerts)
                .where(and(eq(distressAlerts.unitId, data.unitId), inArray(distressAlerts.status, ['active', 'acknowledged'])))
            return { alert: other, reused: true }
        }

        const where = position.latitude !== null
            ? googleMapsLink(position.latitude, position.longitude!) + (gps ? '' : ' (estate location, no GPS)')
            : googleMapsSearchLink(ctx.address)
        const caller = `${me.name || 'Resident'} ${formatNigerianPhone(me.phone)}`
        await notifyInApp(tx, estateId, recipients, {
            type: 'emergency.raised',
            title: `EMERGENCY at ${ctx.house}`,
            body: `${caller} pressed the emergency button at ${formatTime(now)}. Security has been alerted.`,
            staffLink: `/gate/${estateId}`,
            residentLink: '/app',
        })
        pending = recipients.map(r => ({
            to: r.phone,
            body: r.isStaff
                ? `EMERGENCY ${ctx.estateName}: ${ctx.house}. Caller ${caller}. Address: ${ctx.address}. Map: ${where}`
                : `EMERGENCY ${ctx.estateName}: alert raised at ${ctx.house}. Security has been told. Stay safe and keep your gate locked.`,
        }))
        await recordAudit(tx, {
            estateId, actorUserId: actor.userId, action: 'emergency.raised', entityType: 'distress_alert', entityId: alert.id,
            details: { unit: ctx.house, locationSource: position.locationSource, notified: recipients.length },
        })
        return { alert, reused: false }
    })
    await sendPendingSms(pending)
    return result
}

async function loadAlert (tx: Queryable, estateId: string, alertId: string): Promise<DistressAlert> {
    const [a] = await tx.select().from(distressAlerts).where(and(eq(distressAlerts.id, alertId), eq(distressAlerts.estateId, estateId)))
    if (!a) throw new NotFoundError('Alert')
    return a
}

/** The alert screen for the resident: status, nearest police stations and emergency numbers. */
export async function getDistressForResident (actor: Actor, estateId: string, alertId: string) {
    const { alert, ctx } = await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        const a = await loadAlert(tx, estateId, alertId)
        const access = await getEstateAccess(tx, actor, estateId)
        if (!access.residentUnitIds.includes(a.unitId)) throw new NotFoundError('Alert')
        return { alert: a, ctx: await alertContext(tx, estateId, a.unitId) }
    })
    const pos = alertPosition(alert)
    return {
        alert,
        house: ctx.house,
        address: ctx.address,
        mapLink: pos ? googleMapsLink(pos.lat, pos.lng) : googleMapsSearchLink(ctx.address),
        stations: pos ? await nearestPoliceStations(pos.lat, pos.lng) : [],
        emergencyLines: EMERGENCY_LINES,
    }
}

async function staffAndUnitRecipients (tx: Queryable, estateId: string, unitId: string) {
    const all = await estateRecipients(tx, estateId)
    const unitPhones = new Set((await tx.select({ phone: occupancies.phone }).from(occupancies)
        .where(and(eq(occupancies.unitId, unitId), eq(occupancies.status, 'active')))).map(r => r.phone))
    return { staff: all.filter(r => r.isStaff), unit: all.filter(r => unitPhones.has(r.phone)), everyone: all }
}

/** The resident cancels (false alarm). Staff are told by SMS so nobody keeps searching. */
export async function cancelDistress (actor: Actor, estateId: string, alertId: string): Promise<void> {
    let pending: PendingSms[] = []
    await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        const a = await loadAlert(tx, estateId, alertId)
        const access = await getEstateAccess(tx, actor, estateId)
        if (!access.residentUnitIds.includes(a.unitId)) throw new NotFoundError('Alert')
        if (a.status === 'resolved' || a.status === 'false_alarm') throw new AppError('This alert is already closed.')
        await tx.update(distressAlerts).set({ status: 'false_alarm', closedBy: actor.userId, closedAt: new Date(), closingNote: 'Cancelled by resident' })
            .where(eq(distressAlerts.id, alertId))
        const ctx = await alertContext(tx, estateId, a.unitId)
        const { staff, everyone } = await staffAndUnitRecipients(tx, estateId, a.unitId)
        await notifyInApp(tx, estateId, everyone.filter(r => r.userId !== actor.userId), {
            type: 'emergency.cancelled', title: `Alert at ${ctx.house} cancelled`, body: 'The resident says it was a false alarm.',
            staffLink: `/gate/${estateId}`, residentLink: '/app',
        })
        pending = staff.map(r => ({ to: r.phone, body: `${ctx.estateName}: the emergency alert at ${ctx.house} was cancelled by the resident (false alarm).` }))
        await recordAudit(tx, { estateId, actorUserId: actor.userId, action: 'emergency.cancelled', entityType: 'distress_alert', entityId: alertId })
    })
    await sendPendingSms(pending)
}

/** A guard or admin takes the alert. The house's residents are told help is coming. */
export async function acknowledgeDistress (actor: Actor, estateId: string, alertId: string): Promise<void> {
    let pending: PendingSms[] = []
    await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'emergency.respond')
        const a = await loadAlert(tx, estateId, alertId)
        if (a.status !== 'active') throw new AppError(a.status === 'acknowledged' ? 'Someone is already responding to this alert.' : 'This alert is closed.')
        await tx.update(distressAlerts).set({ status: 'acknowledged', acknowledgedBy: actor.userId, acknowledgedAt: new Date() }).where(eq(distressAlerts.id, alertId))
        const [me] = await tx.select({ name: users.name }).from(users).where(eq(users.id, actor.userId))
        const ctx = await alertContext(tx, estateId, a.unitId)
        const { unit } = await staffAndUnitRecipients(tx, estateId, a.unitId)
        const body = `${me.name || 'Estate security'} is responding to your alert at ${ctx.house}.`
        await notifyInApp(tx, estateId, unit, { type: 'emergency.acknowledged', title: 'Security is on the way', body, staffLink: `/gate/${estateId}`, residentLink: '/app' })
        pending = unit.map(r => ({ to: r.phone, body: `${ctx.estateName}: ${body}` }))
        await recordAudit(tx, { estateId, actorUserId: actor.userId, action: 'emergency.acknowledged', entityType: 'distress_alert', entityId: alertId })
    })
    await sendPendingSms(pending)
}

export async function resolveDistress (actor: Actor, estateId: string, alertId: string, note: string, falseAlarm = false): Promise<void> {
    const why = note.trim()
    if (why.length < 3) throw new AppError('Say briefly what happened.')
    await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'emergency.respond')
        const a = await loadAlert(tx, estateId, alertId)
        if (a.status === 'resolved' || a.status === 'false_alarm') throw new AppError('This alert is already closed.')
        await tx.update(distressAlerts).set({
            status: falseAlarm ? 'false_alarm' : 'resolved', closedBy: actor.userId, closedAt: new Date(), closingNote: why.slice(0, 500),
            acknowledgedBy: a.acknowledgedBy ?? actor.userId, acknowledgedAt: a.acknowledgedAt ?? new Date(),
        }).where(eq(distressAlerts.id, alertId))
        const ctx = await alertContext(tx, estateId, a.unitId)
        const { everyone } = await staffAndUnitRecipients(tx, estateId, a.unitId)
        await notifyInApp(tx, estateId, everyone.filter(r => r.userId !== actor.userId), {
            type: 'emergency.resolved', title: `Alert at ${ctx.house} closed`, body: why.slice(0, 200), staffLink: `/estate/${estateId}/emergencies`, residentLink: '/app',
        })
        await recordAudit(tx, { estateId, actorUserId: actor.userId, action: falseAlarm ? 'emergency.false_alarm' : 'emergency.resolved', entityType: 'distress_alert', entityId: alertId, details: { note: why } })
    })
}

const alertColumns = {
    alert: distressAlerts,
    unitLabel: units.label,
    zoneName: zones.name,
    raisedByName: users.name,
    raisedByPhone: users.phone,
}

function withLinks<T extends { alert: DistressAlert, unitLabel: string, zoneName: string }> (rows: T[], estate: { name: string, district: string, city: string, state: string }) {
    return rows.map(r => {
        const address = formatAddress({ houseOrBlock: r.unitLabel, street: r.zoneName, estate: estate.name, district: estate.district || undefined, city: estate.city, state: estate.state })
        const pos = alertPosition(r.alert)
        return { ...r, address, mapLink: pos ? googleMapsLink(pos.lat, pos.lng) : googleMapsSearchLink(address) }
    })
}

/** Open alerts for the gate console and staff overview. */
export async function listOpenAlerts (actor: Actor, estateId: string) {
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'emergency.respond')
        const [rows, [estate]] = await inOrder([
            tx.select(alertColumns).from(distressAlerts)
                .innerJoin(units, eq(units.id, distressAlerts.unitId)).innerJoin(zones, eq(zones.id, units.zoneId))
                .innerJoin(users, eq(users.id, distressAlerts.raisedBy))
                .where(and(eq(distressAlerts.estateId, estateId), inArray(distressAlerts.status, ['active', 'acknowledged'])))
                .orderBy(desc(distressAlerts.createdAt)),
            tx.select().from(estates).where(eq(estates.id, estateId)),
        ])
        return withLinks(rows, estate)
    })
}

/** Alert history for the estate's Emergencies page. */
export async function listAlerts (actor: Actor, estateId: string, limit = 100) {
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'emergency.read')
        const [rows, [estate]] = await inOrder([
            tx.select(alertColumns).from(distressAlerts)
                .innerJoin(units, eq(units.id, distressAlerts.unitId)).innerJoin(zones, eq(zones.id, units.zoneId))
                .innerJoin(users, eq(users.id, distressAlerts.raisedBy))
                .where(eq(distressAlerts.estateId, estateId))
                .orderBy(desc(distressAlerts.createdAt))
                .limit(limit),
            tx.select().from(estates).where(eq(estates.id, estateId)),
        ])
        return withLinks(rows, estate)
    })
}

/** The resident's own open alert for a house, if any (so the home page can show it instead of the button). */
export async function getOpenAlertForUnit (actor: Actor, estateId: string, unitId: string): Promise<DistressAlert | null> {
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        const access = await getEstateAccess(tx, actor, estateId)
        if (!access.residentUnitIds.includes(unitId)) return null
        const [a] = await tx.select().from(distressAlerts)
            .where(and(eq(distressAlerts.unitId, unitId), inArray(distressAlerts.status, ['active', 'acknowledged'])))
        return a ?? null
    })
}
