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
