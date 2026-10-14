-- Row-level security: estate isolation enforced by Postgres, not only by application code.
-- The application connects as a non-owner role (see scripts/db-roles.ts), so these policies always apply to it.
-- Context is set per transaction by withDbContext() in src/db/index.ts.

CREATE FUNCTION app_estate_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.estate_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app_is_system() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.system', true), '') = 'on' $$;
--> statement-breakpoint

-- estates: visible in its own context, to its staff and residents, or to system operations
ALTER TABLE "estates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY estates_read ON "estates" FOR SELECT USING (
    id = app_estate_id()
    OR app_is_system()
    OR EXISTS (SELECT 1 FROM memberships m WHERE m.estate_id = estates.id AND m.user_id = app_user_id() AND m.is_active)
    OR EXISTS (SELECT 1 FROM occupancies o WHERE o.estate_id = estates.id AND o.user_id = app_user_id())
);
--> statement-breakpoint
CREATE POLICY estates_write ON "estates" FOR ALL USING (id = app_estate_id() OR app_is_system()) WITH CHECK (id = app_estate_id() OR app_is_system());
--> statement-breakpoint

-- Purely estate-scoped tables
ALTER TABLE "zones" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY zones_estate ON "zones" FOR ALL USING (estate_id = app_estate_id() OR app_is_system()) WITH CHECK (estate_id = app_estate_id() OR app_is_system());
--> statement-breakpoint
ALTER TABLE "units" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY units_estate ON "units" FOR ALL USING (estate_id = app_estate_id() OR app_is_system()) WITH CHECK (estate_id = app_estate_id() OR app_is_system());
--> statement-breakpoint
ALTER TABLE "vehicles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY vehicles_estate ON "vehicles" FOR ALL USING (estate_id = app_estate_id() OR app_is_system()) WITH CHECK (estate_id = app_estate_id() OR app_is_system());
--> statement-breakpoint
ALTER TABLE "unit_helpers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY unit_helpers_estate ON "unit_helpers" FOR ALL USING (estate_id = app_estate_id() OR app_is_system()) WITH CHECK (estate_id = app_estate_id() OR app_is_system());
--> statement-breakpoint
ALTER TABLE "support_access_grants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY support_grants_estate ON "support_access_grants" FOR ALL USING (estate_id = app_estate_id() OR app_is_system()) WITH CHECK (estate_id = app_estate_id() OR app_is_system());
--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_logs_estate ON "audit_logs" FOR ALL USING (estate_id = app_estate_id() OR app_is_system()) WITH CHECK (estate_id = app_estate_id() OR app_is_system());
--> statement-breakpoint

-- memberships and occupancies: also readable by the person they belong to (for "my estates" across estates)
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY memberships_read ON "memberships" FOR SELECT USING (estate_id = app_estate_id() OR user_id = app_user_id() OR app_is_system());
--> statement-breakpoint
CREATE POLICY memberships_write ON "memberships" FOR ALL USING (estate_id = app_estate_id() OR app_is_system()) WITH CHECK (estate_id = app_estate_id() OR app_is_system());
--> statement-breakpoint
ALTER TABLE "occupancies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY occupancies_read ON "occupancies" FOR SELECT USING (estate_id = app_estate_id() OR user_id = app_user_id() OR app_is_system());
--> statement-breakpoint
CREATE POLICY occupancies_write ON "occupancies" FOR ALL USING (estate_id = app_estate_id() OR app_is_system()) WITH CHECK (estate_id = app_estate_id() OR app_is_system());
