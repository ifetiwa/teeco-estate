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

## Authorisation (Build 3)

Two independent layers:

1. **Capabilities** (`src/lib/access.ts`). Roles map to capabilities in `ROLE_CAPABILITIES`:

   | Role | Can |
   |---|---|
   | Platform admin | Create estates, see counts only. Estate data only through a support grant. |
   | Estate admin | Everything for their estate |
   | Finance officer | Residents (read), finance (read/manage), reports |
   | Guard | Estate layout, gate operations, visitor log. No residents, no finance. |
   | Resident | Nothing estate-wide; own unit only (checked by ownership) |
   | Support (platform admin with a grant) | Read-only: residents, finance, visitors, tickets, reports, audit |

   Domain functions in `src/lib/*` call `requireCapability` themselves, so pages and actions cannot skip checks.

2. **Row-level security in Postgres** (`drizzle/0002_row_level_security.sql`). The app connects as `teeco_app`, a role
   that is not the table owner and has `NOBYPASSRLS` (created by `scripts/db-roles.ts` during migrations). Every
   estate-owned table only returns or accepts rows whose `estate_id` matches `app.estate_id`, which
   `withDbContext()` sets per transaction (`set_config(..., true)`, so pooled connections never carry context over).
   A user's own memberships/occupancies are also visible via `app.user_id` ("my estates" across estates).
   `system` context is used only for estate creation, join-code lookup and platform counts.
   Without a context the app role sees no estate rows at all. `tests/isolation.test.ts` proves both layers.

## Support access and audit

A platform admin must record a reason (at least 10 characters) to open an estate. The grant lasts 2 hours, is read-only,
shows a banner, and every page view is written to `audit_logs`. The estate admin sees all grants under Settings.
`audit_logs` also records estate creation, staff role changes, resident approval/rejection and move-outs.

## Visitors (Build 4)

- `visitor_passes`: created by a current resident for their unit. 6-digit `code` (unique among active passes in the
  estate), single- or multi-use, validity window entered in Lagos time. The QR encodes `TEECO-PASS:<passId>:<code>`.
- `visits`: one arrival at the gate (from a pass or a walk-in) with status
  `awaiting_resident → approved/declined`, `checked_in → checked_out`, or `denied`. This table is the visitor log.
- Gate checks (`verifyGateCode`): wrong format, not found, wrong estate, cancelled, used, expired, not yet valid,
  blocked visitor, curfew; each with a plain-language message. Check-in re-validates under a row lock so a single-use
  pass admits exactly once even with two guards.
- Rate limiting: every lookup is stored in `gate_code_attempts`; 5 failures in 10 minutes lock that guard device
  (identified by an HttpOnly cookie).
- Estate rules live in `estates.settings.visitors` (max passes per resident per day, curfew) plus `blocked_visitors`.
- Residents get in-app `notifications` for arrivals and departures; walk-in requests also go by SMS (sent after commit).
- Visitor log export is CSV with formula-injection protection and is audit-logged.

## Payment records

- `levy_payments`: a payment received from a unit for the **security levy** or the **estate service charge**, recorded
  by a finance officer or estate admin (`finance.manage`). Amount in kobo (check constraint: positive), the months it
  covers (`covers_from`..`covers_to`, first-of-month dates; a label such as "October 2026", "Q4 2026" or "2026" is
  derived), date paid, method and reference. Payments are never deleted: a mistake is voided with a reason, stays in
  the history and drops out of totals. Recording and voiding are audit-logged.
- Each estate sets, in `estates.settings.levies.charges`, the amount each house pays per charge and how often
  (monthly, quarterly or yearly). Period maths lives in `src/lib/periods.ts`; a payment covering several months is
  spread evenly over them, so a yearly payment counts a twelfth towards each month.
- **Who has paid** (`paymentStatus`): for one charge and period, every active house is *paid*, *part paid*, *not paid*
  or *no residents*, with its current residents' phones (call, SMS and WhatsApp links) and when it was last reminded.
  With no amount set, any payment counts as paid.
- **Reminders** (`sendPaymentReminders`, `payment_reminders`): an SMS to every current resident and an in-app
  notification to those with accounts, for one house or all houses that owe. A house isn't reminded about the same
  charge and period twice within 20 hours. Logged and audit-logged.
- **Totals** by year and month of the date paid: per house for its residents (`/home/:id/payments`) and for the
  estate (staff, Payments → Monthly & yearly totals). Residents see the estate's totals only if the estate turns on
  `levies.showEstateTotalsToResidents`; they never see other houses' payments.
- This is a record of money received outside the app. Invoices and online payment (Paystack) come with Build 6.

## Emergencies (distress button)

- A current resident presses and holds the emergency button (2 seconds, so a pocket tap doesn't fire it). The phone's
  GPS position is taken if allowed (positions outside Nigeria are ignored); otherwise the estate's own position from
  Settings is used, otherwise only the house address.
- `distress_alerts` stores the alert. One open alert per house (partial unique index); pressing again re-uses it rather
  than texting everyone again. At most 5 alerts per person per hour.
- Everyone in the estate is notified in-app and by SMS. Guards and other staff get the house, full address, the caller's
  name and phone and a Google Maps link; residents get a shorter "stay alert" message. The gate console, staff overview
  and `/app` show open alerts (with a repeating beep on the gate console) until a guard or admin (`emergency.respond`)
  responds and closes them; the resident can cancel a false alarm.
- The resident's alert screen lists the three nearest active `police_stations` by straight-line distance, then 112 and
  199 (`src/config/emergency.ts`). On a phone it opens the dialer with the nearest number ready; browsers cannot place a
  call without the person tapping call. Police stations are a platform-wide list kept by platform admins (`/platform`);
  only numbers confirmed with the station should be added.
