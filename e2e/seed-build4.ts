// Seeds the Build 4 e2e scenario through the app's domain API. Run by build4-visitors.spec.ts via tsx.
import 'dotenv/config'

import { eq } from 'drizzle-orm'
import { Pool } from 'pg'

import { closeDb, getDb } from '@/db'
import { users } from '@/db/schema'
import { createEstate } from '@/lib/estates'
import { toLagosInputValue } from '@/lib/format'
import { addResident } from '@/lib/residents'
import { addStaff } from '@/lib/staff'
import { addUnits, createZone } from '@/lib/structure'
import { createPass } from '@/lib/visitors'

async function userId (phone: string): Promise<string> {
    const [u] = await getDb().select().from(users).where(eq(users.phone, phone))
    return u.id
}

async function main () {
    const platform = { userId: await userId('+2348030000001'), isPlatformAdmin: true }
    const make = async (name: string, adminPhone: string) => {
        const estate = await createEstate(platform, { name, gateCount: 2, adminName: 'Admin', adminPhone })
        const admin = { userId: await userId(`+234${adminPhone.slice(1)}`), isPlatformAdmin: false }
        const zone = await createZone(admin, estate.id, { name: 'Palm Close' })
        const { created } = await addUnits(admin, estate.id, { zoneId: zone.id, labels: '1-3' })
        return { estate, admin, units: created }
    }
    const main = await make('Visitors Villa', '08035550300')
    const other = await make('Other Estate', '08035550310')
    const ada = await addResident(main.admin, main.estate.id, { unitId: main.units[0].id, name: 'Ada Obi', phone: '08035550301', relation: 'owner' })
    await addStaff(main.admin, main.estate.id, { name: 'Sule Guard', phone: '08035550302', role: 'guard' })
    const otherRes = await addResident(other.admin, other.estate.id, { unitId: other.units[0].id, name: 'Other Resident', phone: '08035550311', relation: 'owner' })
    const now = new Date()
    const window = { validFrom: toLagosInputValue(now), validUntil: toLagosInputValue(new Date(now.getTime() + 3_600_000)) }
    const otherPass = await createPass({ userId: otherRes.userId!, isPlatformAdmin: false }, other.estate.id, { unitId: other.units[0].id, visitorName: 'Wrong Estate Visitor', ...window })
    const expiring = await createPass({ userId: ada.userId!, isPlatformAdmin: false }, main.estate.id, { unitId: main.units[0].id, visitorName: 'Late Visitor', ...window })
    await closeDb()
    // Make one pass expired (owner connection; test setup only)
    const owner = new Pool({ connectionString: process.env.E2E_DATABASE_OWNER_URL })
    await owner.query("update visitor_passes set valid_from = now() - interval '3 hours', valid_until = now() - interval '1 hour' where id = $1", [expiring.id])
    await owner.end()
    process.stdout.write(JSON.stringify({ estateId: main.estate.id, otherCode: otherPass.code, expiredCode: expiring.code }))
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
