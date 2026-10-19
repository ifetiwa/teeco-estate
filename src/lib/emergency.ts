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

/** Where people raising or handling an alert land in the app. */
export const SECURITY_HOME = (estateId: string) => `/security/${estateId}`
const PLATFORM_EMERGENCIES = '/platform#emergencies'

// ---------- Police stations (platform-wide) ----------

const coordinate = (min: number, max: number, what: string) => z.coerce.number({ message: `Enter the ${what}` })
    .refine(v => Number.isFinite(v) && v >= min && v <= max, `Enter a valid ${what}`)

export const policeStationSchema = z.object({
    name: z.string().trim().min(3, 'Enter the station name').max(120),
    area: z.string().trim().max(80).default(''),
    address: z.string().trim().max(200).default(''),
    phone: z.string().optional().transform(v => v?.trim() || undefined)
        .refine(v => !v || normalizeDialNumber(v), 'Enter a phone number, e.g. 08031234567')
        .transform(v => (v ? normalizeDialNumber(v)! : undefined)),
    altPhone: z.string().optional().transform(v => v?.trim() || undefined)
        .refine(v => !v || normalizeDialNumber(v), 'Enter a valid phone number')
        .transform(v => (v ? normalizeDialNumber(v)! : undefined)),
    latitude: coordinate(4, 14, 'latitude'),
    longitude: coordinate(2.5, 15, 'longitude'),
    source: z.string().trim().max(200).optional().transform(v => v || undefined),
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

/** Records that someone called the station's number and it was answered by the station (or clears that). */
export async function setPoliceStationVerified (actor: Actor, stationId: string, verified: boolean): Promise<void> {
    requirePlatformAdmin(actor)
    await getDb().update(policeStations).set({ verifiedAt: verified ? new Date() : null }).where(eq(policeStations.id, stationId))
}

export async function listPoliceStations (actor: Actor): Promise<PoliceStation[]> {
    requirePlatformAdmin(actor)
    return getDb().select().from(policeStations).orderBy(desc(policeStations.isActive), asc(policeStations.name))
}

export type StationWithDistance = PoliceStation & { distanceKm: number | null, isEstateDivision?: boolean }

/** Active stations closest to a point, nearest first. */
export async function nearestPoliceStations (lat: number, lng: number, limit: number = NEAREST_STATIONS_SHOWN): Promise<StationWithDistance[]> {
    const all = await getDb().select().from(policeStations).where(eq(policeStations.isActive, true))
    return all
        .map(s => ({ ...s, distanceKm: distanceKm({ lat, lng }, { lat: s.latitude, lng: s.longitude }) }))
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, limit)
}

/**
 * The stations to call for an alert: the estate's own division first (whatever the distance), then the nearest
 * others to the alert's position, up to NEAREST_STATIONS_SHOWN in all.
 */
export async function stationsForAlert (estateStationId: string | null, pos: { lat: number, lng: number } | null): Promise<StationWithDistance[]> {
    const own = estateStationId
        ? (await getDb().select().from(policeStations).where(and(eq(policeStations.id, estateStationId), eq(policeStations.isActive, true))))[0]
        : undefined
    const nearby = pos ? await nearestPoliceStations(pos.lat, pos.lng, NEAREST_STATIONS_SHOWN + 1) : []
    const out: StationWithDistance[] = []
    if (own) out.push({ ...own, isEstateDivision: true, distanceKm: pos ? distanceKm(pos, { lat: own.latitude, lng: own.longitude }) : null })
    for (const s of nearby) if (s.id !== own?.id && out.length < NEAREST_STATIONS_SHOWN) out.push(s)
    return out
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

/**
 * The estate's map position, used for alerts sent without a GPS fix. If the estate has no police division yet,
 * the nearest one is linked; returns the linked station.
 */
export async function setEstateLocation (actor: Actor, estateId: string, input: z.input<typeof estateLocationSchema>): Promise<PoliceStation | null> {
    const data = estateLocationSchema.parse(input)
    const nearest = data.latitude !== null ? (await nearestPoliceStations(data.latitude, data.longitude!, 1))[0] : undefined
    return withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'estate.manage')
        const [current] = await tx.select({ stationId: estates.policeStationId }).from(estates).where(eq(estates.id, estateId))
        const link = !current?.stationId && nearest ? { policeStationId: nearest.id } : {}
        await tx.update(estates).set({ ...data, ...link }).where(eq(estates.id, estateId))
        const stationId = current?.stationId ?? nearest?.id
        if (!stationId) return null
        const [s] = await getDb().select().from(policeStations).where(eq(policeStations.id, stationId))
        return s ?? null
    })
}

/** An admin picks the police division that covers the estate (or clears it). */
export async function setEstatePoliceStation (actor: Actor, estateId: string, stationId: string | null): Promise<void> {
    if (stationId) {
        const [s] = await getDb().select({ id: policeStations.id }).from(policeStations).where(eq(policeStations.id, stationId))
        if (!s) throw new NotFoundError('Police station')
    }
    await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'estate.manage')
        await tx.update(estates).set({ policeStationId: stationId }).where(eq(estates.id, estateId))
        await recordAudit(tx, { estateId, actorUserId: actor.userId, action: 'estate.police_station_set', details: { stationId } })
    })
}

/** The estate's police division, and every active station ordered by distance from the estate (for the picker). */
export async function getEstatePolice (actor: Actor, estateId: string) {
    const estate = await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'estate.view')
        const [e] = await tx.select({ lat: estates.latitude, lng: estates.longitude, stationId: estates.policeStationId }).from(estates).where(eq(estates.id, estateId))
        if (!e) throw new NotFoundError('Estate')
        return e
    })
    const all = await getDb().select().from(policeStations).where(eq(policeStations.isActive, true)).orderBy(asc(policeStations.name))
    const pos = estate.lat !== null && estate.lng !== null ? { lat: estate.lat, lng: estate.lng } : null
    const options: StationWithDistance[] = all
        .map(s => ({ ...s, distanceKm: pos ? distanceKm(pos, { lat: s.latitude, lng: s.longitude }) : null }))
        .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
    return {
        station: options.find(s => s.id === estate.stationId) ?? null,
        options,
        hasLocation: pos !== null,
        emergencyLines: EMERGENCY_LINES,
    }
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
        estateLat: estates.latitude, estateLng: estates.longitude, policeStationId: estates.policeStationId,
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

/**
 * Who hears about an alert, and how much they are told:
 * - `security`: the estate's guards and estate admins. They get the house, address, caller and map link.
 * - `platform`: Teeco super admins (platform admins), for every estate. Same details as security.
 * - `resident`: everyone else in the estate (residents, finance officers). They are told there is an emergency
 *   and to stay alert, never where it is.
 */
type Audience = 'security' | 'platform' | 'resident'
interface Recipient { userId: string | null, phone: string, audience: Audience }

const RESPONDER_ROLES = ['guard', 'estate_admin'] as const

/** Everyone who should hear about an alert in this estate, deduplicated by phone (the most-informed role wins). */
async function estateRecipients (tx: Queryable, estateId: string): Promise<Recipient[]> {
    const [staff, residents, platform] = await inOrder([
        tx.selectDistinct({ userId: users.id, phone: users.phone, role: memberships.role }).from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(and(eq(memberships.estateId, estateId), eq(memberships.isActive, true))),
        tx.select({ userId: occupancies.userId, phone: occupancies.phone }).from(occupancies)
            .where(and(eq(occupancies.estateId, estateId), eq(occupancies.status, 'active'))),
        tx.select({ userId: users.id, phone: users.phone }).from(users).where(eq(users.isPlatformAdmin, true)),
    ])
    const byPhone = new Map<string, Recipient>()
    for (const s of staff) {
        if ((RESPONDER_ROLES as readonly string[]).includes(s.role)) byPhone.set(s.phone, { userId: s.userId, phone: s.phone, audience: 'security' })
    }
    for (const p of platform) if (!byPhone.has(p.phone)) byPhone.set(p.phone, { userId: p.userId, phone: p.phone, audience: 'platform' })
    for (const s of staff) if (!byPhone.has(s.phone)) byPhone.set(s.phone, { userId: s.userId, phone: s.phone, audience: 'resident' })
    for (const r of residents) if (!byPhone.has(r.phone)) byPhone.set(r.phone, { userId: r.userId, phone: r.phone, audience: 'resident' })
    return [...byPhone.values()]
}

const isResponder = (r: Recipient) => r.audience !== 'resident'

type Message = { title: string, body: string }

/** In-app notifications with the wording for each audience (responders see where; residents don't). */
async function notifyInApp (tx: Queryable, estateId: string, recipients: Recipient[], type: string, forResponders: Message, forResidents: Message | null) {
    const seen = new Set<string>()
    const rows = []
    for (const r of recipients) {
        if (!r.userId || seen.has(r.userId)) continue
        const m = isResponder(r) ? forResponders : forResidents
        if (!m) continue
        seen.add(r.userId)
        const link = r.audience === 'security' ? SECURITY_HOME(estateId) : r.audience === 'platform' ? PLATFORM_EMERGENCIES : '/app'
        rows.push({ estateId, userId: r.userId, type, title: m.title, body: m.body, link })
    }
    if (rows.length) await tx.insert(notifications).values(rows)
}

/**
 * A resident presses the emergency button. Everyone in the estate is told in-app and by SMS, plus Teeco's super admins.
 * Only the estate's security team, estate admins and super admins get the house, address, caller's phone and a
 * Google Maps link; other residents are told to stay alert without being told where. Pressing again while an alert
 * for the house is open returns that alert instead of texting everyone again.
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
        await notifyInApp(tx, estateId, recipients, 'emergency.raised',
            { title: `EMERGENCY at ${ctx.house}, ${ctx.estateName}`, body: `${caller} pressed the emergency button at ${formatTime(now)}. Address: ${ctx.address}.` },
            { title: `Emergency alert in ${ctx.estateName}`, body: 'A resident has raised an emergency. Security is responding. Stay indoors and keep your gate locked.' })
        pending = recipients.map(r => ({
            to: r.phone,
            body: isResponder(r)
                ? `EMERGENCY ${ctx.estateName}: ${ctx.house}. Caller ${caller}. Address: ${ctx.address}. Map: ${where}`
                : `EMERGENCY ${ctx.estateName}: a resident has raised an alert. Security is responding. Stay indoors and keep your gate locked.`,
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
        stations: await stationsForAlert(ctx.policeStationId, pos),
        emergencyLines: EMERGENCY_LINES,
    }
}

async function staffAndUnitRecipients (tx: Queryable, estateId: string, unitId: string) {
    const all = await estateRecipients(tx, estateId)
    const unitPhones = new Set((await tx.select({ phone: occupancies.phone }).from(occupancies)
        .where(and(eq(occupancies.unitId, unitId), eq(occupancies.status, 'active')))).map(r => r.phone))
    return { responders: all.filter(isResponder), unit: all.filter(r => unitPhones.has(r.phone)), everyone: all }
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
        const { responders, everyone } = await staffAndUnitRecipients(tx, estateId, a.unitId)
        await notifyInApp(tx, estateId, everyone.filter(r => r.userId !== actor.userId), 'emergency.cancelled',
            { title: `Alert at ${ctx.house} cancelled`, body: 'The resident says it was a false alarm.' },
            { title: `Emergency alert in ${ctx.estateName} ended`, body: 'It was a false alarm.' })
        pending = responders.map(r => ({ to: r.phone, body: `${ctx.estateName}: the emergency alert at ${ctx.house} was cancelled by the resident (false alarm).` }))
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
        await notifyInApp(tx, estateId, unit, 'emergency.acknowledged', { title: 'Security is on the way', body }, { title: 'Security is on the way', body })
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
        await notifyInApp(tx, estateId, everyone.filter(r => r.userId !== actor.userId), 'emergency.resolved',
            { title: `Alert at ${ctx.house} closed`, body: why.slice(0, 200) },
            { title: `Emergency alert in ${ctx.estateName} ended`, body: 'Security has dealt with it.' })
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

/**
 * Alerts across every estate for Teeco super admins: open ones first, then the latest closed. Super admins are
 * among the people who receive SOS details, so this includes the house, caller and map link.
 */
export async function listPlatformAlerts (actor: Actor, limit = 50) {
    requirePlatformAdmin(actor)
    return withDbContext({ system: true, userId: actor.userId }, async (tx) => {
        const rows = await tx.select({ ...alertColumns, estateName: estates.name, district: estates.district, city: estates.city, state: estates.state })
            .from(distressAlerts)
            .innerJoin(units, eq(units.id, distressAlerts.unitId)).innerJoin(zones, eq(zones.id, units.zoneId))
            .innerJoin(users, eq(users.id, distressAlerts.raisedBy)).innerJoin(estates, eq(estates.id, distressAlerts.estateId))
            .orderBy(sql`${distressAlerts.status} in ('active', 'acknowledged') desc`, desc(distressAlerts.createdAt))
            .limit(limit)
        return rows.map(r => {
            const address = formatAddress({ houseOrBlock: r.unitLabel, street: r.zoneName, estate: r.estateName, district: r.district || undefined, city: r.city, state: r.state })
            const pos = alertPosition(r.alert)
            return { ...r, address, mapLink: pos ? googleMapsLink(pos.lat, pos.lng) : googleMapsSearchLink(address) }
        })
    })
}
