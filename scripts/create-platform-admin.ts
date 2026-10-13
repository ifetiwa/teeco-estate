// Usage: npm run create-platform-admin -- 08031234567 "Full Name"
import 'dotenv/config'

import { sql } from 'drizzle-orm'

import { closeDb, getDb } from '../src/db'
import { users } from '../src/db/schema'
import { requireNigerianPhone } from '../src/lib/phone'

async function main () {
    const [rawPhone, name = ''] = process.argv.slice(2)
    if (!rawPhone) throw new Error('Usage: npm run create-platform-admin -- <phone> "<name>"')
    const phone = requireNigerianPhone(rawPhone)
    const [user] = await getDb().insert(users).values({ phone, name, isPlatformAdmin: true })
        .onConflictDoUpdate({ target: users.phone, set: { isPlatformAdmin: true, name: sql`case when ${users.name} = '' then excluded.name else ${users.name} end` } })
        .returning()
    console.log(`Platform admin ready: ${user.name || '(no name)'} ${user.phone}. Sign in at /signin with this phone.`)
}

main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
}).finally(closeDb)
