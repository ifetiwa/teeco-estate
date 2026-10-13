import { sql } from 'drizzle-orm'

import { getDb } from '@/db'
import { users } from '@/db/schema'
import { type Actor } from '@/lib/access'
import { createEstate } from '@/lib/estates'
import { ConsoleSmsProvider, setSmsProvider } from '@/lib/sms'
import { addUnits, createZone } from '@/lib/structure'

/** Empties every application table (keeps the schema). */
export async function resetDb (): Promise<void> {
    const db = getDb()
    const { rows } = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`)
    if (rows.length) await db.execute(sql.raw(`truncate ${rows.map(r => `"${r.tablename}"`).join(', ')} cascade`))
}

export function useConsoleSms (): ConsoleSmsProvider {
    const sms = new ConsoleSmsProvider()
    setSmsProvider(sms)
    return sms
}

let phoneCounter = 0
/** A fresh valid Nigerian mobile number for each call. */
export function nextPhone (): string {
    phoneCounter++
    return `+234803${String(1000000 + phoneCounter).slice(-7)}`
}

export async function createUser (opts: { name?: string, isPlatformAdmin?: boolean, phone?: string } = {}): Promise<Actor & { phone: string }> {
    const phone = opts.phone ?? nextPhone()
    const [u] = await getDb().insert(users).values({ phone, name: opts.name ?? 'Test User', isPlatformAdmin: opts.isPlatformAdmin ?? false }).returning()
    return { userId: u.id, isPlatformAdmin: u.isPlatformAdmin, phone }
}

export function actorFor (userId: string, isPlatformAdmin = false): Actor {
    return { userId, isPlatformAdmin }
}

/** Platform admin + estate with an admin, one street and the given houses. */
export async function createTestEstate (opts: { name?: string, houses?: string } = {}) {
    const platform = await createUser({ name: 'Teeco Ops', isPlatformAdmin: true })
    const adminPhone = nextPhone()
    const estate = await createEstate(platform, { name: opts.name ?? 'Sunshine Estate', district: 'Lokogoma', gateCount: 2, adminName: 'Chairman Bello', adminPhone })
    const [admin] = await getDb().select().from(users).where(sql`${users.phone} = ${adminPhone}`)
    const adminActor = actorFor(admin.id)
    const zone = await createZone(adminActor, estate.id, { name: '1st Avenue', kind: 'avenue' })
    const { created } = await addUnits(adminActor, estate.id, { zoneId: zone.id, labels: opts.houses ?? '1-5' })
    return { platform, estate, admin: adminActor, adminPhone, zone, units: created }
}
