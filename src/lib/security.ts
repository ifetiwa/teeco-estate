import { and, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm'

import { EMERGENCY_LINES } from '@/config/emergency'
import { inOrder, withDbContext } from '@/db'
import { distressAlerts, estates, visitorPasses, visits, units, zones } from '@/db/schema'
import { type Actor, requireCapability } from '@/lib/access'
import { listOpenAlerts, stationsForAlert } from '@/lib/emergency'
import { startOfLagosDay } from '@/lib/format'

/**
 * Everything the estate's security team needs on one screen: open distress alerts, today's visitor numbers, who is
 * expected, the latest gate activity, and the police numbers for the estate. Guards and estate admins only.
 */
export async function getSecurityDashboard (actor: Actor, estateId: string, now: Date = new Date()) {
    const dayStart = startOfLagosDay(now)
    const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000)
    const data = await withDbContext({ estateId, userId: actor.userId }, async (tx) => {
        await requireCapability(tx, actor, estateId, 'emergency.respond')
        const [[estate], [counts], expected, activity, closedAlerts] = await inOrder([
            tx.select({ name: estates.name, lat: estates.latitude, lng: estates.longitude, stationId: estates.policeStationId, gateCount: estates.gateCount })
                .from(estates).where(eq(estates.id, estateId)),
            tx.select({
                insideNow: sql<number>`count(*) filter (where ${visits.status} = 'checked_in')::int`,
                arrivalsToday: sql<number>`count(*) filter (where ${visits.checkedInAt} >= ${dayStart})::int`,
                waiting: sql<number>`count(*) filter (where ${visits.status} = 'awaiting_resident')::int`,
                deniedToday: sql<number>`count(*) filter (where ${visits.status} in ('denied', 'declined') and ${visits.createdAt} >= ${dayStart})::int`,
            }).from(visits).where(eq(visits.estateId, estateId)),
            // Passes valid at some point today that haven't been used up
            tx.select({ pass: visitorPasses, unitLabel: units.label, zoneName: zones.name }).from(visitorPasses)
                .innerJoin(units, eq(units.id, visitorPasses.unitId)).innerJoin(zones, eq(zones.id, units.zoneId))
                .where(and(eq(visitorPasses.estateId, estateId), eq(visitorPasses.status, 'active'),
                    lte(visitorPasses.validFrom, dayEnd), gte(visitorPasses.validUntil, now)))
                .orderBy(visitorPasses.validFrom)
                .limit(30),
            tx.select({ visit: visits, unitLabel: units.label, zoneName: zones.name }).from(visits)
                .innerJoin(units, eq(units.id, visits.unitId)).innerJoin(zones, eq(zones.id, units.zoneId))
                .where(and(eq(visits.estateId, estateId), or(gte(visits.createdAt, dayStart), gte(visits.checkedOutAt, dayStart))))
                .orderBy(desc(sql`greatest(${visits.createdAt}, coalesce(${visits.checkedInAt}, ${visits.createdAt}), coalesce(${visits.checkedOutAt}, ${visits.createdAt}))`))
                .limit(20),
            tx.select({ alert: distressAlerts, unitLabel: units.label, zoneName: zones.name }).from(distressAlerts)
                .innerJoin(units, eq(units.id, distressAlerts.unitId)).innerJoin(zones, eq(zones.id, units.zoneId))
                .where(and(eq(distressAlerts.estateId, estateId), inArray(distressAlerts.status, ['resolved', 'false_alarm'])))
                .orderBy(desc(distressAlerts.createdAt))
                .limit(5),
        ])
        return { estate, counts, expected, activity, closedAlerts }
    })
    const pos = data.estate.lat !== null && data.estate.lng !== null ? { lat: data.estate.lat, lng: data.estate.lng } : null
    const [openAlerts, stations] = await Promise.all([listOpenAlerts(actor, estateId), stationsForAlert(data.estate.stationId, pos)])
    return { ...data, openAlerts, stations, emergencyLines: EMERGENCY_LINES }
}
