# Teeco Estate: Architecture Notes (Build 0 audit)

Audit of `open-condo-software/condo` at upstream commit `4aee03c5b` (2026-10-13), branch `teeco/main`.
These notes record what the code actually does. Where it differs from the build plan's assumptions, the code wins and the difference is listed in the last section.

## 1. What is actually open source

The monorepo lists 33 apps under `apps/`, but **25 of them are git submodules pointing at private repositories** (see `.gitmodules`).
Each one is an empty folder in a public clone, and `git ls-remote` on them returns "Repository not found".

| Open (source present) | Private (empty submodule) |
|---|---|
| `apps/condo` (4,208 files; the main product) | `apps/resident-app`, `apps/pass`, `apps/announcements` |
| `apps/address-service` | `apps/billing-connector`, `apps/accruals-gateway`, `apps/b2b-payments-gateway`, `apps/ecom-gateway`, `apps/eps`, `apps/debt-management` |
| `apps/dev-portal-api`, `apps/dev-portal-web` | `apps/callcenter`, `apps/telephony`, `apps/telephony-ws-api`, `apps/asterisk-bot`, `apps/employee-bot` |
| `apps/miniapp` (mini-app template) | `apps/news-greenhouse`, `apps/news-telegram-api`, `apps/news-telegram-web`, `apps/documents`, `apps/insurance`, `apps/external-api`, `apps/classifiers-api`, `apps/meter-importer`, `apps/property-importer`, `apps/registry-importer`, `apps/ticket-importer`, `apps/pos-integration`, `apps/property-ai-assistant`, `apps/rb` |

**Consequence:** the open product is the *staff/manager* web app and its GraphQL backend.
The resident mobile app, the visitor-pass app, the payment gateways and the accrual (levy) engines are all closed.
Teeco must build every resident-facing and guard-facing screen, plus the payment gateway, from scratch whichever path is chosen.

`yarn install` prunes the private workspaces from `yarn.lock`. Do not commit that lockfile churn; restore it with `git checkout -- yarn.lock`.

## 2. Stack

- **Backend:** KeystoneJS 5, the community fork `@open-keystone/*` (`.yarnrc.yml` catalog), with GraphQL at `/admin/api`, Knex adapter and Postgres 16.
  Every model is a `GQLListSchema` in `apps/condo/domains/<domain>/schema/<Model>.js`.
  Custom mutations and queries are `GQLCustomSchema` "services" (`...Service.js`).
- **Frontend:** Next.js 15 pages router (`apps/condo/pages/`), Ant Design 4 plus `@open-condo/ui` (`packages/ui`), Apollo client and react-intl.
- **Async:** a worker (`apps/condo/worker.js`, built on `packages/keystone/tasks.js`) with Redis queues. Cron tasks live in `domains/*/tasks/`.
- **Messaging:** NATS (`packages/messaging`) is optional; without it the app logs `CONNECTION_REFUSED` and continues.
- **Migrations:** Django-based, `bin/kmigrator.py`. Files live in `apps/condo/migrations/` (564 files), and the database has 340 tables after migrating.
- **Feature flags:** GrowthBook (`packages/featureflags`). If `FEATURE_TOGGLE_CONFIG` is unset, every flag is false.
- **Code generation:** `bin/createschema` and `bin/createservice` scaffold a model or service with access file, test utilities, GraphQL fragments and migration.
- **Footprint (measured):** the dev server uses about 1.3 GB RAM. In production mode the web server and worker each use about 1.6–1.8 GB. Production build is `keystone build` (Next build, admin UI build and type check).

## 3. How the key concerns are implemented

### Data model and tenancy
- **Tenant = `Organization`** (`domains/organization/schema/Organization.js`).
  It has `country` (Select: `ru`, `en`, `es`), `type` (`MANAGING_COMPANY`, `SERVICE_PROVIDER`, `HOLDING`), `tin` (validated with the Russian INN checksum in `domains/organization/utils/tin.utils.js`), `features` and `subscription`.
- **Staff membership:** `OrganizationEmployee` belongs to an `Organization`, a `User` and an `OrganizationEmployeeRole`.
  The role is a set of boolean permissions such as `canManageTickets`, `canManageProperties`, `canReadPayments` and `canManageEmployees`.
- **Holding links:** `OrganizationLink` lets a holding organisation see child organisations.
- **Property:** `domains/property/schema/Property.js` has `type` (`building` or `village`), `address`, `addressMeta` and a `map` JSON.
  The map is laid out as sections, then floors, then units. Unit types are `flat`, `apartment`, `commercial`, `warehouse` and `parking` (`domains/property/constants/common.js`).
  There is no separate Unit table: units are identified by `unitName` plus `unitType` strings on other models.
- **People:**
  - `Contact` (`domains/contact/schema/Contact.js`) is the manager's record of a person at a unit: `property`, `unitName`, `phone`, `email`, `role` (→ `ContactRole`), `isVerified`.
  - `Resident` (`domains/resident/schema/Resident.js`) is a resident *user* linked to a property and unit; it is created by the resident app through `RegisterResidentService`.
- **Scopes:** `PropertyScope` limits which properties an employee sees.

### Access control
- Each model has `domains/<d>/access/<Model>.js` exporting `canRead…` and `canManage…`.
  Read functions return a Keystone *where-filter*, typically `{ organization: { id_in: permittedOrganizations } }`, so **isolation is enforced at the data layer**.
- Helpers live in `domains/organization/utils/accessSchema.js`: `getEmployedOrRelatedOrganizationsByPermissions` and `checkPermissionsInEmployedOrRelatedOrganizations`.
- `User.type` is one of `staff`, `resident` or `service` (`domains/user/constants/common.js`). Flags `isAdmin` and `isSupport` return `{}`, meaning **unrestricted read of all tenants with no audit**. This conflicts with the plan's "support access must be logged" rule.
- Change history comes from the `historical` plugin (`packages/keystone/plugins/historical.js`), which writes `<Model>HistoryRecord` tables. This is a usable base for audit logs.

### Authentication
- Email and password: `AuthenticateUserWithEmailAndPasswordService`.
- Phone and password: `AuthenticateUserWithPhoneAndPasswordService`.
- Phone OTP: `ConfirmPhoneAction` plus `ConfirmPhoneActionService`, then `AuthenticateOrRegisterUserWithTokenService`.
- Two-factor authentication: `ChangeTwoFactorAuthenticationService`. Sudo tokens and an OIDC provider are also present.
- hCaptcha is optional; it logs "not configured" and continues.

### Tickets (complaints)
- `domains/ticket/`: `Ticket`, `TicketStatus` (OPEN, IN_PROGRESS, DECLINED, COMPLETED, DEFERRED, CLOSED; IDs in `constants/statusTransitions.js`), `TicketComment`, `TicketFile` (photos), `TicketChange` (history) and `TicketAutoAssignment`.
- Classification is three-level: `TicketPlaceClassifier`, `TicketCategoryClassifier` and `TicketProblemClassifier`, with 148 problem rows seeded by migrations. Names are i18n keys such as `ticket.category.classifier.PASS.name`.
- Deadlines come from `TicketOrganizationSetting`.

### Invoices, billing and payments
- **`BillingReceipt`** and friends (`domains/billing/`) are *imported* from external billing systems through `BillingIntegration` contexts (`RegisterBillingReceiptsService`). Condo does **not** compute accruals itself; that was done by the private accrual apps.
- **`marketplace.Invoice`** (`domains/marketplace/schema/Invoice.js`) is an ad-hoc, staff-created invoice with `rows`, `toPay`, `status`, `paymentType` and `currencyCode`.
- **Acquiring** (`domains/acquiring/`):
  - `AcquiringIntegration` is an external payment app identified by `hostUrl`.
  - `AcquiringIntegrationContext` holds the per-organisation settings.
  - `MultiPayment` and `Payment` hold amounts, fees and statuses (`constants/payment.js`).
  - `RegisterMultiPaymentService` creates the payment, then the external gateway app drives it and updates statuses as a service user.
  - The only gateway implementations are private submodules.
  - The recipient bank details are Russian (`RECIPIENT_FIELDS_DEFINITION` in `constants/gql.js`: `tin`, `iec`/KPP, `bic`, `bankAccount`, `offsettingAccount`).
- **SaaS billing:** `domains/subscription/` has `SubscriptionPlan` (`trialDays`, `planType`), `SubscriptionPlanPricingRule` and `SubscriptionContext`. This is a reusable base for Build 11.

### Notifications
- `domains/notification/`: `Message` (typed templates), `MessageBatch`, `NotificationUserSetting` and `RemoteClient`/`RemoteClientPushToken`.
- Transports are in `transports/`. Adapters in `adapters/`:
  - push: `firebaseAdapter`, `appleAdapter`, `hcmAdapter`, `oneSignalAdapter`, `redStoreAdapter`
  - SMS: `smsAdapter.js`, with providers **SMS.ru, SMSC.ru, Twilio and Instasent**, selected by `SMS_PROVIDER`
  - `webhookAdapter`
- `SMS_ALLOWED_PHONE_PREFIXES` restricts destinations.
- Message templates are files under `apps/condo/lang/<locale>/messages/`.

### Notices (announcements)
- `domains/news/`: `NewsItem` (`type`: `common` or `emergency`, plus title, body, validity and `sendAt`) and `NewsItemScope` (`property`, `unitType`, `unitName`).
  This can already target a property, a section of units or one unit.
- `NewsItemTemplate` and `NewsItemUserRead` track templates and read receipts.
- There are **no polls or votes**. `packages/surveys` is PostHog product-survey wiring, not resident voting.

### Translations
- `apps/condo/lang/{en,es,ru}/{locale}.json` holds 4,189 keys each, plus `messages/` templates.
- `conf.DEFAULT_LOCALE` comes from `.env` and is `en` in `.env.example`.
- The deprecated constant `DEFAULT_LOCALE` in `domains/common/constants/locale.js` is hard-coded to `ru`.
- Per-country role names and phone regex live in `domains/common/constants/countries.js`, which has no Nigeria entry.
- Currency: `domains/common/constants/currencies.js` sets `DEFAULT_CURRENCY_CODE = 'RUB'`. NGN is present in the ISO list.

### Addresses
- `apps/address-service` provides search providers `DadataSearchProvider` (Russia), `PullentiSearchProvider` (Russia) and `GoogleSearchProvider`.
- Local dev sets `FAKE_ADDRESS_SERVICE_CLIENT=true` (`apps/condo/bin/prepare.js`).

### Mini-app extension system
- `domains/miniapp/`:
  - `B2BApp`: staff-side iframe apps, with `B2BAppContext` per organisation, `B2BAppRole`/`B2BAppPermission`, and `B2BAppAccessRight` (a service user with scoped rights).
  - `B2CApp`: resident-side apps, rendered only inside the **private** resident app.
- Iframe ↔ host communication uses `packages/bridge`. `apps/miniapp` is a starter template.
- This is the cleanest way to add Teeco features without forking core: a Teeco app gets its own database, talks to condo over GraphQL as a service user, and shows inside the condo sidebar.

### UI shell
- The sidebar menu is defined in `apps/condo/pages/_app.tsx` (`menuCategoriesData`, around line 223) and gated by role permissions and feature flags. This is where Build 1 hides screens.
- The layout lives in `domains/common/components/containers/BaseLayout/`.

## 4. Local setup on this machine (Windows 11, no Docker or WSL)

Postgres and Redis run as portable binaries in `~/teeco-tools/` (no admin rights, nothing installed system-wide):

```bash
# Postgres 16.14 (EnterpriseDB zip). Data in ~/teeco-tools/pgdata; user postgres / password postgres; localhost only
~/teeco-tools/pgsql/bin/pg_ctl.exe -D ~/teeco-tools/pgdata -l ~/teeco-tools/pg.log -o "-c listen_addresses=127.0.0.1 -c max_connections=500" start
# Redis 8.10 (redis-windows build), in-memory only
~/teeco-tools/redis/Redis-8.10.2-Windows-x64-msys2/redis-server.exe --bind 127.0.0.1 --save "" --appendonly no
```

Windows-specific workarounds, recorded so the next developer does not rediscover them:

1. **Yarn:** run `corepack enable --install-directory ~/bin yarn`. Turbo needs a `yarn` binary on PATH.
   If `turbo` is not found from a workspace script, run `node_modules/turbo-windows-64/bin/turbo.exe build --filter='@app/condo^...'`.
2. **`python3`:** the Windows `python3` is a Microsoft Store stub, and `packages/cli` `safeExec` strips the environment to `PATH`, `HOME` and `USER`.
   Without `APPDATA` Python cannot see user site-packages, and without UTF-8 mode it crashes on emoji in migration output.
   The fix is a venv at `~/teeco-tools/pyenv` (Django 5.2, psycopg2-binary 2.9.11) plus shims `~/bin/python3` and `~/bin/python3.cmd` that set `PYTHONUTF8=1` and call the venv's Python.
3. **`apps/condo/bin/prepare.js`** passed JSON in single quotes, which `cmd.exe` does not understand.
   It now uses double-quoted, escaped JSON, which works in both sh and cmd. This is the **only upstream file changed** in Build 0.
4. The prepare script assigned **port 4009**, not 4006 as the README says (ports are allocated by app order). See `SERVER_URL` in `apps/condo/.env`.
5. Skip `build:static` (it builds Storybook into `public/ui`). For the worker, `PHASE=build yarn exec keystone build` is enough.

Run:

```bash
cd apps/condo
NODE_ENV=development node ../../bin/run-keystone-app.js          # dev on http://localhost:4009
PHASE=build yarn exec keystone build                              # production build (needed by the worker)
PHASE=worker DISABLE_NEXT_APP=true node worker.js                 # worker
```

Admin login: `admin@example.com`, with the password in `DEFAULT_TEST_ADMIN_SECRET` in `apps/condo/.env` (git-ignored).

## 5. Where the plan's assumptions differ from the code

| Plan assumption | Reality |
|---|---|
| Condo has a resident app we can adapt | `apps/resident-app` is private. A resident UI must be built from scratch. |
| Condo may have visitor passes | `apps/pass` is private. The open code only has a `PASS` *ticket category*. |
| "Using Condo's invoice features" for levies | Receipts are imported from external accrual systems, and `marketplace.Invoice` is ad-hoc. There is no recurring-charge engine. |
| Payment layer can be extended | The acquiring protocol is open, but every gateway implementation is private, and recipient fields are Russian (BIC, INN, KPP). |
| Five roles | Condo has permission-flag roles for **staff** only. Residents are a separate `User.type`. Guard and finance officer map to custom `OrganizationEmployeeRole` rows, and platform admin to `isAdmin`/`isSupport` (with unaudited global read). |
| Streets or blocks, then units | `Property.map` is sections → floors → units, designed for apartment blocks. An estate is best modelled as one `Property` of type `village` with streets as sections, or as one `Property` per street; this needs a decision in Build 2. |
| Polls exist or are close | There are none. |
| `docker compose up -d postgresdb redis` | `postgresdb` (which fronts `postgresdb-master` and `postgresdb-replica`) sits behind the `dbs` profile: use `docker compose --profile dbs up -d` (from `AGENTS.md`). |
| App on :4006 | The port is assigned by `bin/prepare.js`; here it is 4009. |
