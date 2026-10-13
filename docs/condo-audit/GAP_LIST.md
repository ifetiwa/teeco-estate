# Teeco Estate: Gap List and Decision Gate (Build 0)

Paths are relative to `apps/condo/` unless stated. For the background, see `ARCHITECTURE_NOTES.md`.

## 1. Reuse, change, hide, replace

| Condo feature (location) | Verdict | Notes for Teeco |
|---|---|---|
| `Organization` + `OrganizationEmployee` + `OrganizationEmployeeRole` (`domains/organization`) | **Reuse** | One estate = one `Organization` of type `MANAGING_COMPANY`. Estate admin, finance officer and guard become role rows with suitable `can*` flags. |
| Access-control pattern (`domains/*/access/*.js`, `organization/utils/accessSchema.js`) | **Reuse** | It already isolates at the data layer. Add cross-estate tests in Build 3. |
| `isAdmin` / `isSupport` global read | **Change** | The plan requires logged, reasoned support access. A new `SupportAccessGrant` model must gate reads and log them. |
| `Property` + `map` (`domains/property`) | **Change** | Use type `village` with sections as streets or blocks and units as houses. The map UI is built for apartment floors, so it needs a simplified Teeco editor. |
| `Contact` (`domains/contact`) | **Reuse + extend** | Add move-in and move-out dates, primary-contact flag and approval status. Owner, tenant and household roles go in `ContactRole`. |
| `Resident` + `RegisterResidentService` (`domains/resident`) | **Change** | Depends on the address service and on the private resident app. Self-registration with a join code is new. |
| Phone OTP (`ConfirmPhoneAction*`, `AuthenticateOrRegisterUserWithTokenService`) | **Reuse** | Needs a Nigerian SMS adapter. |
| 2FA, sudo tokens, history records | **Reuse** | Base for Build 12. |
| Tickets (`domains/ticket`) | **Reuse + change** | Replace the seeded classifiers with the 7 Teeco categories. Map statuses: assigned = IN_PROGRESS with executor set. Hide call-records and incidents. |
| News (`domains/news`) | **Reuse** | Notices with property, section or unit scope. Add an "owners only" audience and a pin option. |
| Notifications (`domains/notification`) | **Reuse + extend** | Add a Termii SMS provider to `adapters/smsAdapter.js` and a web-push transport. Firebase is optional. |
| Subscription (`domains/subscription`) | **Change** | Base for Teeco SaaS plans and trials (Build 11). Payment-recipient flow is RU-specific. |
| Acquiring (`domains/acquiring`) | **Change** | Keep `MultiPayment` and `Payment` as the ledger of online payments. Write a **new Paystack gateway app** that speaks the acquiring protocol. Replace recipient fields (BIC/INN/KPP) with NUBAN plus bank code. |
| Billing receipts (`domains/billing`) | **Replace or adapt** | Designed for imported receipts. Levies need a new charge and schedule engine that writes receipts or invoices. |
| `marketplace.Invoice` | **Possibly reuse** | Could carry one-off special levies. |
| Meters (`domains/meter`) | **Hide** | Not in scope for estates (prepaid meters are common in Abuja). |
| Banking (`domains/banking`, SBBOL integration) | **Hide** | Russian bank integration. |
| Marketplace, AI, call records, incidents, telephony | **Hide** | Not in the plan. Gate via `pages/_app.tsx` menu and feature flags. |
| Address service (`apps/address-service`: Dadata, Pullenti) | **Replace** | Use the fake client plus manual Nigerian address fields (estate, street, house or block, flat). Google provider optional later. |
| `domains/common/constants/countries.js`, `currencies.js`, `locale.js` | **Change** | Add `ng` country (`+234` regex, en locale, NGN), default currency NGN, timezone Africa/Lagos. |
| `organization/utils/tin.utils.js` | **Change** | Nigerian TIN or RC number format, or make it optional. |
| `lang/ru`, `lang/es` | **Hide** | Keep the files (upstream merges) but restrict selectable locales to `en`. |

## 2. Country-specific items found (must not be visible to a Nigerian user)

- Default currency `RUB` (`domains/common/constants/currencies.js:194`). `₽` appears in UI formatting.
- Deprecated `DEFAULT_LOCALE = 'ru'` (`domains/common/constants/locale.js`). Locale switcher offers ru and es.
- Russian INN checksum (`domains/organization/utils/tin.utils.js`), required on org registration (`RegisterNewOrganizationService`, `FindOrganizationsByTinService`).
- Bank recipient fields BIC, INN, KPP and offsetting account (`domains/acquiring/constants/gql.js`).
- SMS providers SMS.ru and SMSC.ru (`domains/notification/adapters/smsAdapter.js`).
- Push providers HCM and RedStore (Huawei, Russian app store) (`domains/notification/adapters`).
- Address providers Dadata and Pullenti (`apps/address-service`). `VALID_HOUSE_TYPES` are Russian words (`domains/property/constants/common.js`).
- Banking domain built around Russian bank APIs (`domains/banking`).
- Telegram bots and Asterisk telephony (private apps; menu entries in condo).
- Ticket classifiers seeded for Russian housing services (148 problem rows).

## 3. Functional gaps (required by the plan, absent from the open code)

| # | Gap | Size | Notes |
|---|---|---|---|
| G1 | **Visitor passes**: pass model, numeric code + QR, validity windows, single or multi use, rules (max per day, blocklist, curfew), check-in and check-out log, walk-in approval | Large | `apps/pass` is private. New domain from scratch. |
| G2 | **Guard interface**: large-button screen, code entry, QR camera scan, offline queue and sync, per-device rate limit | Large | New. A guard user is staff in Condo terms but needs its own minimal UI. |
| G3 | **Nigerian payments (Paystack, later Flutterwave)**: initialise, verify webhook (HMAC SHA-512), idempotency, subaccount or split settlement to the estate, manual transfer proof | Large | Gateways are private. The acquiring protocol is undocumented outside code. |
| G4 | **Levy logic**: charge types, amount rules (flat, by unit type, custom), schedules, scheduled invoice generation, per-unit ledger, arrears ageing, part and advance payments, waivers, late fees, PDF receipts and statements, reminders | Large | Condo imports receipts; the accrual engine is private. |
| G5 | **SMS provider (Termii)** behind the existing adapter interface; per-estate SMS cost tracking; sender-ID registration (owner action) | Small | Add a class in `smsAdapter.js` and a cost counter. |
| G6 | **PWA**: resident app (pay, passes, tickets, notices, polls) and guard app; installable; web push; offline-tolerant | Large | Resident app is private. Must be built new (Next.js) against the GraphQL API. |
| G7 | **Polls and votes** (per unit or per resident, closing time, immutable results) | Medium | New. |
| G8 | **Estate self-registration** with join code and approval queue | Medium | New service plus admin UI. |
| G9 | **Vehicles and domestic staff per unit** | Small | New models. |
| G10 | **Audited support access** for platform admins | Small | New model plus access-function change. |
| G11 | **Teeco platform console** (estate onboarding, usage, CSV import with preview) | Medium | Partly via the Keystone admin UI; CSV import of units and residents is new. |
| G12 | **NDPA 2023** consent capture, data export and deletion requests | Medium | Condo has a `ResetUserService` (deletion) but no consent or export flow. |
| G13 | **Reports**: collections, arrears, visitor volume, exports, monthly email | Medium | Analytics domain covers tickets only. |
| G14 | **Nigeria locale**: `en-NG` formats, NGN, Africa/Lagos, +234 validation | Small | Config plus constants. |

## 4. Decision gate: extend Condo or lean custom build

Estimates are in developer-days for one developer working with Claude Code. They are rough; the range reflects Condo's learning curve.

| Build | Extend Condo | Lean custom (Next.js, TypeScript, Postgres) | Why |
|---|---|---|---|
| 1 Nigeria config and branding | 5–8 | 2–3 | Condo needs RU/ES strings, providers and menu items hidden across a 4,200-file app. Custom starts clean. |
| 2 Estate and resident model | 6–10 | 5–7 | `Property.map` and `Contact` fit poorly with estates and streets. Custom models are simple. |
| 3 Roles and isolation | 4–6 | 5–7 | Condo's org-scoped access is a real head start; custom needs row-level filtering (or Postgres RLS) plus tests. |
| 4 Visitor passes | 10–14 | 8–10 | New in both. Keystone boilerplate (schema, access, migrations, codegen) is heavier. |
| 5 Levies and invoicing | 10–14 | 8–10 | New engine in both. Condo adds the cost of fitting it into BillingReceipt and acquiring semantics. |
| 6 Payments (Paystack) | 8–12 | 5–7 | Condo needs a separate gateway app plus the undocumented acquiring protocol; custom calls Paystack directly. |
| 7 Complaints | 3–5 | 5–7 | Condo's tickets are mature; custom builds them. |
| 8 Notices, polls, notifications | 6–8 | 7–9 | News and notifications are reusable in Condo; polls are new in both. |
| 9 Resident and guard PWA | 12–16 | 10–12 | New in both (resident app is private). Custom shares one codebase with the backend. |
| 10 Dashboard and reports | 5–7 | 5–7 | Similar. |
| 11 SaaS billing and onboarding | 6–8 | 6–8 | Condo has a subscription domain but it is RU-shaped. |
| 12 Security and NDPA | 5–7 | 5–7 | Condo has 2FA and history; custom has a smaller attack surface. |
| 13 Testing | 6–8 | 5–6 | Condo's Jest suite is large and slow; extra CI time. |
| 14 Deployment and operations | 8–12 | 3–5 | Condo needs ≥4–8 GB RAM per environment (measured: web server and worker about 1.6–1.8 GB each in production mode) plus Redis and a worker. A lean app fits small or free-tier hosting. |
| **Total (Builds 1–14)** | **≈ 94–135 days** | **≈ 79–105 days** | |

**Other factors**

- **For Condo:** mature multi-tenant access control, tickets, news, notifications, 2FA, change history and a full staff admin UI already exist. That is real value for Builds 3, 7 and 8.
- **Against Condo:**
  - The parts Teeco most needs (resident app, passes, payment gateways, accrual engine) are exactly the private ones.
  - The stack is a community fork of KeystoneJS 5 (end of life upstream).
  - The codebase is Russia-centric and large, with 340 tables after migration.
  - Local setup on Windows needed several workarounds (see `ARCHITECTURE_NOTES.md` section 4).
  - Hosting cost in naira is materially higher.
- **Upstream merges:** Teeco would modify core files (`pages/_app.tsx`, constants, access functions), so merging upstream updates will be painful in practice whichever way the code is organised.

**Recommendation: lean custom build** (Next.js + TypeScript + Postgres, for example with Prisma or Drizzle).
Reuse Condo's *ideas*:
- the organisation/employee/role-flags tenancy model
- access functions that return where-filters
- ticket status transitions
- news scopes
- the SMS adapter interface
- history records

The custom build is about 15–25% faster across the plan, cheaper to host for pilots, and far simpler to maintain. It is not dramatically faster on effort alone; the stronger arguments are that the private apps remove most of Condo's advantage, plus the hosting cost and maintainability.

**Status: STOPPED for the owner's decision**, as section 1 of the build plan requires. Builds 1+ do not start until the owner chooses.
