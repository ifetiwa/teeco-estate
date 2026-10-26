/**
 * Gives an app-store reviewer (or any tester) a ready-made account in the demo estate, without touching anything else:
 *
 *   npm run add-reviewer -- 07000000199                 (local database, from .env)
 *   npm run add-reviewer -- 07000000199 --production    (live database, from .env.neon)
 *
 * The phone becomes an estate admin of Sunshine Gardens Estate and the owner of a free home there, so every screen
 * (admin, gate, payments, passes, emergency) has data. It is never made a platform admin, so it can't see real
 * estates. Safe to run again. Needs the demo estates (npm run seed:demo) and the person's sign-in code in
 * TEST_LOGIN_CODES on the server they will use.
 */
import { config } from 'dotenv'
import { Pool } from 'pg'

import { closeDb } from '../src/db'
import type { Actor } from '../src/lib/access'
import { requireNigerianPhone } from '../src/lib/phone'
import { addResident } from '../src/lib/residents'
import { addStaff } from '../src/lib/staff'

const DEMO_ESTATE = 'Sunshine Gardens Estate'
const NAME = 'Demo Reviewer'

async function main () {
    const [rawPhone, ...flags] = process.argv.slice(2)
    if (!rawPhone) throw new Error('Usage: npm run add-reviewer -- <phone> [--production]')
    const phone = requireNigerianPhone(rawPhone)
    if (flags.includes('--production')) {
        // .env.neon (from `vercel env pull` / Neon) names the owner and app-role URLs differently
        const neon = config({ path: '.env.neon', processEnv: {}, quiet: true }).parsed ?? {}
        if (!neon.DATABASE_URL_UNPOOLED || !neon.NEON_APP_DATABASE_URL) throw new Error('.env.neon needs DATABASE_URL_UNPOOLED and NEON_APP_DATABASE_URL')
        process.env.DATABASE_OWNER_URL = neon.DATABASE_URL_UNPOOLED
        process.env.DATABASE_URL = neon.NEON_APP_DATABASE_URL
        console.log(`Using the live database (${new URL(neon.DATABASE_URL_UNPOOLED).host})`)
    } else {
        config({ quiet: true })
    }
    const owner = new Pool({ connectionString: process.env.DATABASE_OWNER_URL, max: 1 })
    try {
        const { rows: [estate] } = await owner.query<{ id: string, join_code: string }>('select id, join_code from estates where name = $1', [DEMO_ESTATE])
        if (!estate) throw new Error(`No "${DEMO_ESTATE}" here. Create the demo estates first with npm run seed:demo -- <your phone>.`)
        const { rows: [admin] } = await owner.query<{ user_id: string }>(
            "select user_id from memberships where estate_id = $1 and role = 'estate_admin' and is_active and user_id <> (select coalesce((select id from users where phone = $2), gen_random_uuid())) limit 1",
            [estate.id, phone])
        if (!admin) throw new Error(`${DEMO_ESTATE} has no estate admin to act as`)
        const actor: Actor = { userId: admin.user_id, isPlatformAdmin: false }

        await addStaff(actor, estate.id, { name: NAME, phone, role: 'estate_admin' })

        const { rows: [home] } = await owner.query<{ id: string, label: string }>(
            "select o.unit_id as id, u.label from occupancies o join units u on u.id = o.unit_id join users p on p.id = o.user_id where o.estate_id = $1 and p.phone = $2 and o.status in ('pending', 'active') limit 1",
            [estate.id, phone])
        let label = home?.label
        if (!home) {
            const { rows: [free] } = await owner.query<{ id: string, label: string }>(
                "select u.id, u.label from units u where u.estate_id = $1 and u.is_active and not exists (select 1 from occupancies o where o.unit_id = u.id and o.status in ('pending', 'active')) order by u.created_at limit 1",
                [estate.id])
            if (!free) throw new Error(`No free home left in ${DEMO_ESTATE}`)
            await addResident(actor, estate.id, { unitId: free.id, name: NAME, phone, relation: 'owner', isPrimary: true, moveInDate: '2025-01-15' })
            label = free.label
        }
        console.log(`${rawPhone} is now an estate admin of ${DEMO_ESTATE} and lives at ${label}. Join code: ${estate.join_code}`)
    } finally {
        await owner.end()
        await closeDb()
    }
}

main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
})
