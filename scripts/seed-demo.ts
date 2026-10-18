/**
 * Demo data for sales demos and testing: three Abuja estates with streets, residents, staff, passes and visits.
 *
 *   npm run seed:demo -- 07065239875
 *
 * The phone given becomes platform admin, estate admin of every demo estate, and a resident in Sunshine Gardens.
 * Re-running deletes and recreates the demo estates only (matched by name). Needs DATABASE_URL (app role) and
 * DATABASE_OWNER_URL (owner, used only to reset the demo estates and to backdate history).
 * Demo personas use clearly fake numbers in the +234700000xxxx range.
 */
import 'dotenv/config'

import { eq, sql } from 'drizzle-orm'
import { Pool } from 'pg'

import { closeDb, getDb, withDbContext } from '../src/db'
import { users } from '../src/db/schema'
import type { Actor } from '../src/lib/access'
import { setEstateLocation } from '../src/lib/emergency'
import { createEstate, ensureUserByPhone } from '../src/lib/estates'
import { toLagosInputValue } from '../src/lib/format'
import { recordPayment, sendPaymentReminders, updateChargeSettings } from '../src/lib/levies'
import { requireNigerianPhone } from '../src/lib/phone'
import { addResident, addVehicle, addHelper, registerAsResident } from '../src/lib/residents'
import { addStaff } from '../src/lib/staff'
import { addUnits, createZone } from '../src/lib/structure'
import {
    blockVisitor, checkInApprovedWalkIn, checkInWithPass, checkOutVisit, createPass, decideWalkIn, denyPassEntry, logWalkIn, updateVisitorRules,
} from '../src/lib/visitors'

const FIRST = ['Adaeze', 'Chinedu', 'Ngozi', 'Emeka', 'Funke', 'Tunde', 'Aisha', 'Musa', 'Zainab', 'Ibrahim', 'Kemi', 'Segun', 'Halima', 'Uche',
    'Blessing', 'Femi', 'Amaka', 'Yusuf', 'Bola', 'Obinna', 'Hauwa', 'Kunle', 'Nkechi', 'Sani', 'Ifeoma', 'Dayo', 'Fatima', 'Chidi', 'Yetunde', 'Garba']
const LAST = ['Okafor', 'Adeyemi', 'Bello', 'Eze', 'Ogunleye', 'Abubakar', 'Nwosu', 'Danjuma', 'Okonkwo', 'Lawal', 'Ibekwe', 'Adebayo', 'Usman',
    'Obi', 'Afolabi', 'Mohammed', 'Chukwu', 'Olawale', 'Yakubu', 'Nnamdi']
const VISITORS = ['Kemi Adebayo', 'DHL Courier', 'Jumia Delivery', 'Mr Peter (plumber)', 'Aunty Grace', 'Glovo Rider', 'Pastor James', 'Dr Hassan',
    'Chef Tola', 'Electrician Musa', 'Mama Ngozi', 'Bolt Driver', 'Cousin Emeka', 'Tailor Bayo']
const MAKES = ['Toyota Corolla', 'Toyota Camry', 'Honda Accord', 'Lexus RX350', 'Toyota Highlander', 'Kia Sorento', 'Hyundai Elantra', 'Mercedes C300']
const COLOURS = ['Black', 'Silver', 'White', 'Grey', 'Blue', 'Wine']
const PLATE_LGA = ['ABJ', 'KUJ', 'GWA', 'BWR', 'AMC', 'ABC', 'RBC', 'KWL']

const DEMO_ESTATES = [
    {
        name: 'Sunshine Gardens Estate', district: 'Lokogoma', lat: 8.981, lng: 7.471, street: 'Plot 214, Lokogoma District', gates: 2,
        zones: [
            { name: 'Palm Avenue', kind: 'avenue' as const, labels: '1-12', type: 'duplex' as const },
            { name: 'Cedar Close', kind: 'close' as const, labels: '1-8', type: 'bungalow' as const },
            { name: 'Block A', kind: 'block' as const, labels: 'Flat 1-Flat 6', type: 'flat' as const },
        ],
    },
    {
        name: 'Royal Palms Estate', district: 'Gwarinpa', lat: 9.108, lng: 7.405, street: '3rd Avenue, Gwarinpa', gates: 3,
        zones: [
            { name: '1st Avenue', kind: 'avenue' as const, labels: '1-10', type: 'house' as const },
            { name: '2nd Avenue', kind: 'avenue' as const, labels: '1-10', type: 'house' as const },
            { name: 'Crescent 3', kind: 'crescent' as const, labels: '1-6', type: 'terrace' as const },
        ],
    },
    {
        name: 'Emerald Court', district: 'Wuye', lat: 9.062, lng: 7.452, street: 'Off Ladoke Akintola Boulevard, Wuye', gates: 1,
        zones: [
            { name: 'Block B', kind: 'block' as const, labels: 'Flat 1-Flat 8', type: 'flat' as const },
            { name: 'Block C', kind: 'block' as const, labels: 'Flat 1-Flat 8', type: 'flat' as const },
        ],
    },
]

/** Fixed demo personas (fake numbers) for testing other roles in Sunshine Gardens. */
export const PERSONAS = {
    guard: { phone: '07000000101', name: 'Sule Ahmed (Guard)' },
    finance: { phone: '07000000102', name: 'Grace Okon (Finance)' },
    resident: { phone: '07000000103', name: 'Chioma Eze (Resident)' },
    applicant: { phone: '07000000104', name: 'Musa Garba (Applicant)' },
}

let seq = 0
const rand = (() => { let s = 20261015; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648 })()
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]
const fakePhone = () => `+2347000${String(10000 + (seq++)).padStart(6, '0').slice(-6)}`
const fakePlate = () => `${pick(PLATE_LGA)}${100 + Math.floor(rand() * 899)}${String.fromCharCode(65 + Math.floor(rand() * 26))}${String.fromCharCode(65 + Math.floor(rand() * 26))}`
const hours = (h: number) => new Date(Date.now() + h * 3_600_000)

async function userIdFor (phone: string): Promise<string> {
    const [u] = await getDb().select({ id: users.id }).from(users).where(eq(users.phone, requireNigerianPhone(phone)))
    return u.id
}
const actorOf = async (phone: string): Promise<Actor> => ({ userId: await userIdFor(phone), isPlatformAdmin: false })

async function main () {
    const ownerPhoneRaw = process.argv[2]
    if (!ownerPhoneRaw) throw new Error('Usage: npm run seed:demo -- <your phone>')
    const ownerPhone = requireNigerianPhone(ownerPhoneRaw)
    const ownerUrl = process.env.DATABASE_OWNER_URL
    if (!ownerUrl) throw new Error('DATABASE_OWNER_URL must be set (used to reset demo estates and backdate history)')
    const owner = new Pool({ connectionString: ownerUrl, max: 2 })

    // Reset previous demo estates (cascades to everything inside them)
    const names = DEMO_ESTATES.map(e => e.name)
    const removed = await owner.query('delete from estates where name = any($1) returning id', [names])
    if (removed.rowCount) console.log(`Removed ${removed.rowCount} previous demo estate(s)`)

    // You: platform admin
    const ownerUserId = await ensureUserByPhone(ownerPhone, 'Teeco Admin')
    await getDb().update(users).set({ isPlatformAdmin: true }).where(eq(users.id, ownerUserId))
    const platform: Actor = { userId: ownerUserId, isPlatformAdmin: true }
    const you: Actor = { userId: ownerUserId, isPlatformAdmin: false }
    for (const p of Object.values(PERSONAS)) await ensureUserByPhone(p.phone, p.name)

    const summary: string[] = []
    for (const [index, def] of DEMO_ESTATES.entries()) {
        const estate = await createEstate(platform, { name: def.name, district: def.district, street: def.street, gateCount: def.gates, adminName: 'Teeco Admin', adminPhone: ownerPhone, contactPhone: '07000000001' })
        await owner.query("update estates set status = 'active' where id = $1", [estate.id])
        // Approximate district centre (demo only), used when an alert has no GPS fix
        await setEstateLocation(you, estate.id, { latitude: String(def.lat), longitude: String(def.lng) })
        const unitsByZone: Array<{ zone: string, units: Array<{ id: string, label: string }> }> = []
        for (const z of def.zones) {
            const zone = await createZone(you, estate.id, { name: z.name, kind: z.kind })
            const { created } = await addUnits(you, estate.id, { zoneId: zone.id, labels: z.labels, type: z.type })
            unitsByZone.push({ zone: z.name, units: created })
        }
        const allUnits = unitsByZone.flatMap(z => z.units)

        // Staff
        const guardPhone = index === 0 ? PERSONAS.guard.phone : fakePhone()
        await addStaff(you, estate.id, { name: index === 0 ? PERSONAS.guard.name : `${pick(FIRST)} ${pick(LAST)} (Guard)`, phone: guardPhone, role: 'guard' })
        await addStaff(you, estate.id, { name: `${pick(FIRST)} ${pick(LAST)} (Guard)`, phone: fakePhone(), role: 'guard' })
        await addStaff(you, estate.id, { name: index === 0 ? PERSONAS.finance.name : `${pick(FIRST)} ${pick(LAST)} (Finance)`, phone: index === 0 ? PERSONAS.finance.phone : fakePhone(), role: 'finance_officer' })
        const guard = await actorOf(guardPhone)

        // Residents in about 75% of units
        const residentsByUnit = new Map<string, Actor[]>()
        let residentCount = 0
        for (const [i, unit] of allUnits.entries()) {
            const isYourHome = index === 0 && i === 4
            const isPersonaHome = index === 0 && i === 2
            if (!isYourHome && !isPersonaHome && rand() < 0.25) continue
            const family = pick(LAST)
            const actors: Actor[] = []
            const primary = isYourHome
                ? await addResident(you, estate.id, { unitId: unit.id, name: 'Teeco Admin', phone: ownerPhone, relation: 'owner', moveInDate: '2024-03-01' })
                : isPersonaHome
                    ? await addResident(you, estate.id, { unitId: unit.id, name: PERSONAS.resident.name, phone: PERSONAS.resident.phone, relation: 'owner', moveInDate: '2023-06-15' })
                    : await addResident(you, estate.id, { unitId: unit.id, name: `${pick(FIRST)} ${family}`, phone: fakePhone(), relation: rand() < 0.7 ? 'owner' : 'tenant', moveInDate: `202${Math.floor(rand() * 5)}-0${1 + Math.floor(rand() * 9)}-1${Math.floor(rand() * 9)}` })
            actors.push({ userId: primary.userId!, isPlatformAdmin: false })
            residentCount++
            if (rand() < 0.6) {
                const m = await addResident(you, estate.id, { unitId: unit.id, name: `${pick(FIRST)} ${family}`, phone: fakePhone(), relation: 'household' })
                actors.push({ userId: m.userId!, isPlatformAdmin: false })
                residentCount++
            }
            residentsByUnit.set(unit.id, actors)
            if (rand() < 0.7) await addVehicle(you, estate.id, { unitId: unit.id, plate: fakePlate(), make: pick(MAKES), colour: pick(COLOURS) }).catch(() => undefined)
            if (rand() < 0.35) await addHelper(you, estate.id, { unitId: unit.id, name: `${pick(FIRST)} ${pick(['(driver)', '(nanny)', '(cleaner)', '(gardener)'])}`, role: pick(['driver', 'nanny', 'cleaner', 'gardener'] as const) })
        }

        // Pending join requests
        if (index === 0) {
            await registerAsResident({ userId: await userIdFor(PERSONAS.applicant.phone), isPlatformAdmin: false }, { joinCode: estate.joinCode, unitId: allUnits[allUnits.length - 1].id, name: PERSONAS.applicant.name, relation: 'tenant' })
        }
        const extraApplicant = await ensureUserByPhone(fakePhone(), `${pick(FIRST)} ${pick(LAST)}`)
        const emptyUnit = allUnits.find(u => !residentsByUnit.has(u.id))
        if (emptyUnit) await registerAsResident({ userId: extraApplicant, isPlatformAdmin: false }, { joinCode: estate.joinCode, unitId: emptyUnit.id, name: `${pick(FIRST)} ${pick(LAST)}`, relation: 'owner' })

        // A blocked visitor
        await blockVisitor(you, estate.id, { name: 'Unknown Hawker', phone: '07000099999', reason: 'Repeated trespassing reported by residents' })

        // Visitor history: passes over the last 3 days, some used and checked out, some inside now, some upcoming
        const occupiedUnits = [...residentsByUnit.entries()]
        const backdate: Array<{ table: 'visits' | 'visitor_passes', id: string, hoursAgo: number }> = []
        for (let v = 0; v < 14; v++) {
            const [unitId, actors] = occupiedUnits[v % occupiedUnits.length]
            const resident = actors[0]
            const hoursAgo = 2 + v * 4.5
            const pass = await createPass(resident, estate.id, {
                unitId, visitorName: VISITORS[v % VISITORS.length], purpose: pick(['Visit', 'Delivery', 'Repairs', 'Family visit', 'Meeting']),
                validFrom: toLagosInputValue(hours(-hoursAgo - 1)), validUntil: toLagosInputValue(hours(-hoursAgo + 6)),
                vehiclePlate: rand() < 0.4 ? fakePlate() : undefined,
            }, hours(-hoursAgo - 1))
            backdate.push({ table: 'visitor_passes', id: pass.id, hoursAgo: hoursAgo + 1 })
            if (v % 7 === 6) {
                const denied = await denyPassEntry(guard, estate.id, pass.id, 'Visitor had no ID', 1 + (v % def.gates))
                backdate.push({ table: 'visits', id: denied.id, hoursAgo })
                continue
            }
            const visit = await checkInWithPass(guard, estate.id, pass.id, 1 + (v % def.gates), hours(-hoursAgo))
            backdate.push({ table: 'visits', id: visit.id, hoursAgo })
            if (v > 2) await checkOutVisit(guard, estate.id, visit.id, hours(-hoursAgo + 1.5))
        }
        // Upcoming passes (the resident persona and you each have one)
        for (const [unitId, actors] of occupiedUnits.slice(0, 3)) {
            await createPass(actors[0], estate.id, { unitId, visitorName: pick(VISITORS), purpose: 'Visit', validFrom: toLagosInputValue(hours(1)), validUntil: toLagosInputValue(hours(10)), usage: 'multi' })
        }
        // Walk-ins: one approved and inside, one declined, one waiting for the resident right now
        const [wUnit, wActors] = occupiedUnits[1]
        const w1 = await logWalkIn(guard, estate.id, { unitId: wUnit, visitorName: 'Glovo Rider', purpose: 'Food delivery', gate: 1 })
        await decideWalkIn(wActors[0], estate.id, w1.id, true)
        await checkInApprovedWalkIn(guard, estate.id, w1.id)
        const w2 = await logWalkIn(guard, estate.id, { unitId: occupiedUnits[2][0], visitorName: 'Sales Agent', purpose: 'Marketing', gate: 1 })
        await decideWalkIn(occupiedUnits[2][1][0], estate.id, w2.id, false, 'Not interested')
        const yourUnit = index === 0 ? allUnits[4].id : occupiedUnits[3][0]
        await logWalkIn(guard, estate.id, { unitId: yourUnit, visitorName: 'Mr Peter (plumber)', visitorPhone: '07000088888', purpose: 'Fix kitchen sink', gate: 1 })

        // Payments: monthly security levy and a yearly service charge, paid by most (not all) houses
        const months = ['2026-07', '2026-08', '2026-09', '2026-10']
        const finance = await actorOf(index === 0 ? PERSONAS.finance.phone : ownerPhone)
        const levy = [10_000, 15_000, 20_000][index]
        const serviceCharge = [120_000, 150_000, 250_000][index]
        await updateChargeSettings(you, estate.id, {
            securityAmount: String(levy), securityFrequency: 'monthly', serviceAmount: String(serviceCharge), serviceFrequency: 'yearly',
            showEstateTotalsToResidents: index === 0 ? 'on' : '',
        })
        for (const [unitId] of occupiedUnits) {
            const paysUpTo = rand() < 0.15 ? 0 : 1 + Math.floor(rand() * months.length)
            for (let m = 0; m < paysUpTo; m++) {
                await recordPayment(finance, estate.id, {
                    unitId, kind: 'security_levy', amount: String(levy), coversFrom: months[m],
                    paidOn: `2026-${String(7 + m).padStart(2, '0')}-0${1 + Math.floor(rand() * 8)}`,
                    method: pick(['bank_transfer', 'bank_transfer', 'cash', 'pos'] as const), reference: rand() < 0.7 ? `TRF${100000 + Math.floor(rand() * 899999)}` : undefined,
                })
            }
            if (rand() < 0.6) {
                // Most pay the full year; some pay half
                const half = rand() < 0.25
                await recordPayment(finance, estate.id, {
                    unitId, kind: 'service_charge', amount: String(half ? serviceCharge / 2 : serviceCharge), coversFrom: '2026-01', coversTo: '2026-12',
                    paidOn: `2026-0${1 + Math.floor(rand() * 6)}-1${Math.floor(rand() * 9)}`, method: 'bank_transfer', reference: `TRF${100000 + Math.floor(rand() * 899999)}`,
                })
            }
        }

        // Last month's security levy reminders already went out
        await sendPaymentReminders(finance, estate.id, { kind: 'security_levy', periodKey: '2026-09' })

        // Rules last, so the curfew doesn't block the backfilled history
        await updateVisitorRules(you, estate.id, { maxPassesPerResidentPerDay: 10, curfewEnabled: index === 1 ? 'on' : '', curfewStart: '23:30', curfewEnd: '05:00' })
        for (const b of backdate) {
            await owner.query(`update ${b.table} set created_at = now() - make_interval(mins => $2) where id = $1`, [b.id, Math.round(b.hoursAgo * 60)])
        }
        summary.push(`${def.name} (${def.district}): ${allUnits.length} units, ${residentCount} residents, join code ${estate.joinCode}`)
    }

    // Make history notifications look read except the latest few
    await withDbContext({ system: true }, tx => tx.execute(sql`update notifications set read_at = now() where read_at is null and type <> 'visitor.walk_in_request'`))

    await owner.end()
    await closeDb()
    console.log('\nDemo estates ready:')
    for (const s of summary) console.log(`  - ${s}`)
    console.log(`\nYou (${ownerPhoneRaw}): platform admin, estate admin of all demo estates, resident at Palm Avenue 5 (Sunshine Gardens).`)
    console.log('Demo personas in Sunshine Gardens (fake numbers):')
    for (const [role, p] of Object.entries(PERSONAS)) console.log(`  - ${role}: ${p.phone} ${p.name}`)
}

main().catch(async (e) => {
    console.error(e)
    await closeDb()
    process.exit(1)
})
