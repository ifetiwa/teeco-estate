# Architecture

## Layout

```
src/app/            Next.js routes (pages, server actions, API routes)
src/db/schema.ts    Drizzle schema (single source of truth); SQL migrations in drizzle/
src/db/index.ts     Connection pool
src/lib/            Domain logic, kept free of UI code so it can be unit tested
scripts/            CLI scripts (migrate, seed, jobs)
tests/              Vitest tests; run against a real Postgres test database
```

## Principles

- **Tenancy:** an *estate* is the tenant. Every estate-owned row has `estate_id`. Isolation is enforced in the data layer (Build 3), not only in the UI.
- **Money:** integer kobo (`bigint`) everywhere; formatted as NGN only at the edge.
- **Time:** stored as `timestamptz` (UTC); displayed in `Africa/Lagos`.
- **Phones:** stored in E.164 (`+234…`).
- **Providers** (SMS, payments, push) sit behind interfaces with a dev/fake implementation, so the app runs with no paid accounts.
- **Never hold estate funds:** payments settle directly to the estate's account through the provider.

## Data model (Build 2)

- `estates`: the tenant. `join_code` (6 chars) lets residents self-register; `settings` holds overrides of `PLATFORM_DEFAULTS`.
- `zones`: streets, blocks, closes, etc. `units`: houses or flats within a zone (no separate floors; estates are low-rise).
- `memberships`: staff roles per estate (`estate_admin`, `finance_officer`, `guard`). Platform admins are `users.is_platform_admin`.
- `occupancies`: people at a unit (`owner`, `tenant`, `household`), with status `pending → active → moved_out` (or `rejected`).
  Resident access is *derived* from active occupancies, so moving someone out ends their access while keeping history.
  Partial unique indexes enforce one primary contact per unit and one open record per phone per unit.
- `vehicles`, `unit_helpers`: per unit; deactivated (not deleted) when removed or when the unit empties.

## Authentication

Phone + SMS one-time code (6 digits, 10-minute expiry, 5 attempts, 3 sends per 15 minutes; codes stored as HMAC).
Sessions are random tokens in an HttpOnly cookie, stored hashed in `sessions`, 30-day rolling expiry.
SMS goes through `SmsProvider`; development uses `ConsoleSmsProvider` (logs, and appends to `DEV_SMS_OUTBOX` if set).

## Authorisation

Domain functions in `src/lib/*` take an `Actor` and check access themselves (`requireStaffRole`, `requirePlatformAdmin`),
so pages and server actions cannot skip checks. Every estate-owned query filters on `estate_id`.
