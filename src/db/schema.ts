// Database schema. Every estate-owned table carries estate_id (see docs/ARCHITECTURE.md).
import { sql } from 'drizzle-orm'
import { type AnyPgColumn, bigint, boolean, date, doublePrecision, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

const id = () => uuid('id').primaryKey().defaultRandom()
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const estateId = () => uuid('estate_id').notNull().references(() => estates.id, { onDelete: 'cascade' })

// ---------- Users and authentication ----------

export const users = pgTable('users', {
    id: id(),
    phone: text('phone').notNull().unique(), // E.164, +234…
    email: text('email'),
    name: text('name').notNull().default(''),
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    createdAt: createdAt(),
}, (t) => [uniqueIndex('users_email_unique').on(sql`lower(${t.email})`).where(sql`${t.email} is not null`)])

export const otpCodes = pgTable('otp_codes', {
    id: id(),
    phone: text('phone').notNull(),
    codeHash: text('code_hash').notNull(),
    purpose: text('purpose').notNull().default('signin'),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
}, (t) => [index('otp_codes_phone_idx').on(t.phone, t.createdAt)])

export const sessions = pgTable('sessions', {
    id: id(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
})

// ---------- Estates and structure ----------

export const estateStatus = pgEnum('estate_status', ['trial', 'active', 'suspended'])

export const estates = pgTable('estates', {
    id: id(),
    name: text('name').notNull(),
    street: text('street').notNull().default(''), // address of the estate itself
    district: text('district').notNull().default(''),
    city: text('city').notNull().default('Abuja'),
    state: text('state').notNull().default('FCT'),
    contactPhone: text('contact_phone'),
    contactEmail: text('contact_email'),
    logoPath: text('logo_path'),
    gateCount: integer('gate_count').notNull().default(1),
    // Map position of the estate (WGS84). Used when a distress alert has no GPS fix, and to find nearby police.
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    // The police division that covers the estate, shown first on every distress alert. Set from the nearest station or by an admin.
    policeStationId: uuid('police_station_id').references((): AnyPgColumn => policeStations.id, { onDelete: 'set null' }),
    joinCode: text('join_code').notNull().unique(),
    settings: jsonb('settings').notNull().default({}), // overrides of PLATFORM_DEFAULTS
    status: estateStatus('status').notNull().default('trial'),
    createdAt: createdAt(),
})

export const zoneKind = pgEnum('zone_kind', ['street', 'block', 'close', 'crescent', 'avenue', 'phase'])

/** A street, block or other grouping inside an estate. */
export const zones = pgTable('zones', {
    id: id(),
    estateId: estateId(),
    name: text('name').notNull(),
    kind: zoneKind('kind').notNull().default('street'),
    createdAt: createdAt(),
}, (t) => [uniqueIndex('zones_estate_name_unique').on(t.estateId, sql`lower(${t.name})`)])

export const unitType = pgEnum('unit_type', ['house', 'flat', 'duplex', 'terrace', 'bungalow', 'shop', 'plot'])

export const units = pgTable('units', {
    id: id(),
    estateId: estateId(),
    zoneId: uuid('zone_id').notNull().references(() => zones.id, { onDelete: 'restrict' }),
    label: text('label').notNull(), // house number, or e.g. "B2 Flat 4"
    type: unitType('type').notNull().default('house'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
}, (t) => [
    uniqueIndex('units_zone_label_unique').on(t.zoneId, sql`lower(${t.label})`),
    index('units_estate_idx').on(t.estateId),
])

// ---------- People ----------

export const staffRole = pgEnum('staff_role', ['estate_admin', 'finance_officer', 'guard'])

/** Estate staff roles. Residents are represented by occupancies, not memberships. */
export const memberships = pgTable('memberships', {
    id: id(),
    estateId: estateId(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: staffRole('role').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
}, (t) => [uniqueIndex('memberships_estate_user_role_unique').on(t.estateId, t.userId, t.role)])

export const occupantRelation = pgEnum('occupant_relation', ['owner', 'tenant', 'household'])
export const occupancyStatus = pgEnum('occupancy_status', ['pending', 'active', 'rejected', 'moved_out'])

/** A person living at (or owning) a unit. userId is null for people added by the admin who have not signed up. */
export const occupancies = pgTable('occupancies', {
    id: id(),
    estateId: estateId(),
    unitId: uuid('unit_id').notNull().references(() => units.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    email: text('email'),
    relation: occupantRelation('relation').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    status: occupancyStatus('status').notNull().default('pending'),
    moveInDate: date('move_in_date'),
    moveOutDate: date('move_out_date'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    createdAt: createdAt(),
}, (t) => [
    index('occupancies_estate_status_idx').on(t.estateId, t.status),
    index('occupancies_unit_idx').on(t.unitId),
    index('occupancies_user_idx').on(t.userId),
    // At most one primary contact among current occupants of a unit
    uniqueIndex('occupancies_one_primary_per_unit').on(t.unitId).where(sql`${t.isPrimary} and ${t.status} = 'active'`),
    // A phone can only have one open (pending/active) occupancy per unit
    uniqueIndex('occupancies_open_phone_per_unit').on(t.unitId, t.phone).where(sql`${t.status} in ('pending', 'active')`),
])

export const vehicles = pgTable('vehicles', {
    id: id(),
    estateId: estateId(),
    unitId: uuid('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
    plate: text('plate').notNull(), // stored upper-case without spaces, e.g. ABC123DE
    make: text('make').notNull().default(''),
    colour: text('colour').notNull().default(''),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
}, (t) => [uniqueIndex('vehicles_estate_plate_active').on(t.estateId, t.plate).where(sql`${t.isActive}`)])

export const helperRole = pgEnum('helper_role', ['driver', 'cleaner', 'nanny', 'cook', 'gardener', 'security', 'artisan', 'other'])

/** Domestic staff and regular service providers attached to a unit. */
export const unitHelpers = pgTable('unit_helpers', {
    id: id(),
    estateId: estateId(),
    unitId: uuid('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phone: text('phone'),
    role: helperRole('role').notNull().default('other'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
})

// ---------- Support access and audit ----------

/** Time-limited, reasoned, read-only access by a platform admin to one estate's data. */
export const supportAccessGrants = pgTable('support_access_grants', {
    id: id(),
    estateId: estateId(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
}, (t) => [index('support_access_grants_lookup_idx').on(t.estateId, t.userId, t.expiresAt)])

export const auditLogs = pgTable('audit_logs', {
    id: id(),
    estateId: uuid('estate_id').references(() => estates.id, { onDelete: 'set null' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(), // e.g. support.granted, support.viewed, staff.role_added
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    details: jsonb('details').notNull().default({}),
    createdAt: createdAt(),
}, (t) => [index('audit_logs_estate_created_idx').on(t.estateId, t.createdAt)])

// ---------- Visitors (Build 4) ----------

export const passUsage = pgEnum('pass_usage', ['single', 'multi'])
export const passStatus = pgEnum('pass_status', ['active', 'used', 'cancelled', 'expired'])

/** A resident's pre-approval for a visitor. `code` is the 6-digit gate code; unique among active passes in an estate. */
export const visitorPasses = pgTable('visitor_passes', {
    id: id(),
    estateId: estateId(),
    unitId: uuid('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
    visitorName: text('visitor_name').notNull(),
    visitorPhone: text('visitor_phone'),
    purpose: text('purpose').notNull().default(''),
    vehiclePlate: text('vehicle_plate'),
    code: text('code').notNull(),
    usage: passUsage('usage').notNull().default('single'),
    usesCount: integer('uses_count').notNull().default(0),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    status: passStatus('status').notNull().default('active'),
    createdAt: createdAt(),
}, (t) => [
    uniqueIndex('visitor_passes_active_code').on(t.estateId, t.code).where(sql`${t.status} = 'active'`),
    index('visitor_passes_unit_idx').on(t.unitId, t.createdAt),
    index('visitor_passes_creator_day_idx').on(t.createdBy, t.createdAt),
])

export const visitKind = pgEnum('visit_kind', ['pass', 'walk_in'])
export const visitStatus = pgEnum('visit_status', ['awaiting_resident', 'approved', 'declined', 'denied', 'checked_in', 'checked_out', 'cancelled'])

/** One visitor arrival at the gate, from a pass or as a walk-in. */
export const visits = pgTable('visits', {
    id: id(),
    estateId: estateId(),
    unitId: uuid('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
    passId: uuid('pass_id').references(() => visitorPasses.id, { onDelete: 'set null' }),
    kind: visitKind('kind').notNull(),
    status: visitStatus('status').notNull(),
    visitorName: text('visitor_name').notNull(),
    visitorPhone: text('visitor_phone'),
    vehiclePlate: text('vehicle_plate'),
    purpose: text('purpose').notNull().default(''),
    gate: integer('gate').notNull().default(1),
    note: text('note'), // reason for denial/decline
    loggedBy: uuid('logged_by').references(() => users.id, { onDelete: 'set null' }), // guard
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }), // resident for walk-ins
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    checkedInBy: uuid('checked_in_by').references(() => users.id, { onDelete: 'set null' }),
    checkedOutAt: timestamp('checked_out_at', { withTimezone: true }),
    checkedOutBy: uuid('checked_out_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
}, (t) => [
    index('visits_estate_created_idx').on(t.estateId, t.createdAt),
    index('visits_estate_status_idx').on(t.estateId, t.status),
    index('visits_unit_idx').on(t.unitId, t.createdAt),
])

/** Visitors an estate has barred, matched by phone and/or name. */
export const blockedVisitors = pgTable('blocked_visitors', {
    id: id(),
    estateId: estateId(),
    name: text('name'),
    phone: text('phone'),
    reason: text('reason').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
})

/** Every gate code lookup, for per-device rate limiting and abuse review. */
export const gateCodeAttempts = pgTable('gate_code_attempts', {
    id: id(),
    estateId: estateId(),
    deviceId: text('device_id').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    success: boolean('success').notNull(),
    createdAt: createdAt(),
}, (t) => [index('gate_code_attempts_device_idx').on(t.estateId, t.deviceId, t.createdAt)])

// ---------- In-app notifications (extended with push/SMS channels in Build 8) ----------

export const notifications = pgTable('notifications', {
    id: id(),
    estateId: estateId(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // visitor.arrived, visitor.left, visitor.walk_in_request, ...
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
}, (t) => [index('notifications_user_created_idx').on(t.userId, t.createdAt)])

// ---------- Levy and service charge payment records ----------

export const chargeKind = pgEnum('charge_kind', ['security_levy', 'service_charge'])
export const paymentMethod = pgEnum('payment_method', ['bank_transfer', 'cash', 'pos', 'online', 'other'])

/**
 * A payment received from a unit, recorded by finance staff. Never deleted: mistakes are voided with a reason.
 * `covers_from`..`covers_to` are the first days of the first and last month the payment is for (inclusive), so a
 * payment for October 2026 has both set to 2026-10-01 and a yearly service charge runs from January to December.
 */
export const levyPayments = pgTable('levy_payments', {
    id: id(),
    estateId: estateId(),
    unitId: uuid('unit_id').notNull().references(() => units.id, { onDelete: 'restrict' }),
    kind: chargeKind('kind').notNull(),
    amountKobo: bigint('amount_kobo', { mode: 'number' }).notNull(),
    coversFrom: date('covers_from').notNull(),
    coversTo: date('covers_to').notNull(),
    period: text('period').notNull(), // label derived from the covered months, e.g. "October 2026" or "2026"
    paidOn: date('paid_on').notNull(),
    method: paymentMethod('method').notNull().default('bank_transfer'),
    reference: text('reference'), // bank or receipt reference
    payerName: text('payer_name'),
    note: text('note'),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by').references(() => users.id, { onDelete: 'set null' }),
    voidReason: text('void_reason'),
    createdAt: createdAt(),
}, (t) => [
    index('levy_payments_estate_paid_idx').on(t.estateId, t.paidOn),
    index('levy_payments_estate_covers_idx').on(t.estateId, t.kind, t.coversFrom, t.coversTo),
    index('levy_payments_unit_idx').on(t.unitId, t.paidOn),
])

/** Payment reminders sent to a house, so staff can see who was chased and the same house isn't texted twice a day. */
export const paymentReminders = pgTable('payment_reminders', {
    id: id(),
    estateId: estateId(),
    unitId: uuid('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
    kind: chargeKind('kind').notNull(),
    periodKey: text('period_key').notNull(), // e.g. 2026-10, 2026-Q4 or 2026
    outstandingKobo: bigint('outstanding_kobo', { mode: 'number' }).notNull().default(0),
    message: text('message'),
    sentBy: uuid('sent_by').references(() => users.id, { onDelete: 'set null' }),
    recipients: integer('recipients').notNull().default(0),
    createdAt: createdAt(),
}, (t) => [index('payment_reminders_lookup_idx').on(t.estateId, t.kind, t.periodKey, t.unitId, t.createdAt)])

// ---------- Emergencies ----------

export const distressStatus = pgEnum('distress_status', ['active', 'acknowledged', 'resolved', 'false_alarm'])
export const locationSource = pgEnum('location_source', ['gps', 'estate', 'none'])

/** A resident's emergency (panic button) alert. */
export const distressAlerts = pgTable('distress_alerts', {
    id: id(),
    estateId: estateId(),
    unitId: uuid('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
    raisedBy: uuid('raised_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    accuracyMeters: integer('accuracy_meters'),
    locationSource: locationSource('location_source').notNull(),
    status: distressStatus('status').notNull().default('active'),
    notifiedCount: integer('notified_count').notNull().default(0),
    acknowledgedBy: uuid('acknowledged_by').references(() => users.id, { onDelete: 'set null' }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    closedBy: uuid('closed_by').references(() => users.id, { onDelete: 'set null' }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closingNote: text('closing_note'),
    createdAt: createdAt(),
}, (t) => [
    index('distress_alerts_estate_created_idx').on(t.estateId, t.createdAt),
    // At most one open alert per house; pressing again re-uses it
    uniqueIndex('distress_alerts_one_open_per_unit').on(t.unitId).where(sql`${t.status} in ('active', 'acknowledged')`),
])

/** Police stations in Abuja, maintained by platform admins. Platform-wide (no estate_id). */
export const policeStations = pgTable('police_stations', {
    id: id(),
    name: text('name').notNull(), // e.g. "Lokogoma Police Division"
    area: text('area').notNull().default(''),
    address: text('address').notNull().default(''),
    phone: text('phone'), // null when no direct line is published; alerts then fall back to the command lines
    altPhone: text('alt_phone'),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    source: text('source'), // where the number came from, e.g. "FCT Police Command list, July 2022"
    verifiedAt: timestamp('verified_at', { withTimezone: true }), // set when someone has called the number and confirmed it
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
})
