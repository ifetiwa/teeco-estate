# Owner decisions

| Decision | Needed by | Status |
|---|---|---|
| Condo base vs lean custom build | End of Build 0 | **Decided 2026-10-13: lean custom build** (Next.js, TypeScript, Postgres). Rationale in `docs/condo-audit/GAP_LIST.md` section 4. |
| Product name and domain | Build 1 | Open. "Teeco Estate" used as working name; the name is set in one place (`src/config/brand.ts`). |
| Pricing model and fee levels | Build 6 and 11 | Open |
| SMS provider and sender ID | Build 8 | Open. Termii assumed, behind an interface; dev uses a console provider. |
| Paystack business account | Build 6 | Open. Build 6 is developed against test-mode keys. |
| Hosting provider and region | Build 14 | Interim: Vercel (Hobby) at https://teeco-estate.vercel.app, deployed from `teeco/main` with `vercel deploy --prod`. Database not connected yet: owner chose not to use the existing paid Neon org; a free Postgres (e.g. a Neon free account) is pending. Note: Vercel Hobby is for non-commercial use; a paid plan or other host is needed before charging estates. |
| Lawyer for NDPA and contracts | Build 12 | Open |
| Pilot estates | Build 15 | Open |
