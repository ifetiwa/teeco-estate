// Database schema. Every estate-owned table carries estate_id (see docs/ARCHITECTURE.md).
import { sql } from 'drizzle-orm'
import { boolean, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

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
