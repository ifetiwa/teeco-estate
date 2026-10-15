# Teeco Estate

Multi-estate management platform for gated estates and residents' associations in Abuja:
levies and payments, visitor passes, complaints, notices and polls.

Owner: Teeco Enterprise Limited (RC 8211994). "Teeco Estate" is a working name.

## Stack

Next.js (App Router) + TypeScript, Postgres with Drizzle ORM, Tailwind CSS, Vitest.
Money is stored as integer kobo. See `docs/ARCHITECTURE.md`.

## Local setup

Requirements: Node.js 24+, Postgres 16.

```bash
npm install
cp .env.example .env            # then set SESSION_SECRET and database URLs
createdb teeco_dev && createdb teeco_test
npm run db:migrate              # apply migrations to DATABASE_URL
npm run dev                     # http://localhost:3000
npm test                        # unit/integration tests against TEST_DATABASE_URL (schema is recreated)
npm run create-platform-admin -- 08031234567 "Your Name"   # first Teeco admin
npm run seed:demo -- 08031234567   # demo estates; you become admin of all of them (re-run to reset)
npx next build && npm run test:e2e  # browser tests against E2E_DATABASE_URL (npx playwright install chromium once)
```

Schema changes: edit `src/db/schema.ts`, run `npm run db:generate`, commit the SQL in `drizzle/`.

## Docs

- `docs/ARCHITECTURE.md`: how the app is built (tenancy, roles, money, jobs)
- `docs/DECISIONS.md`: owner decisions and their status
- `docs/condo-audit/`: Build 0 audit of Condo that led to the custom build
