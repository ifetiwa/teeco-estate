-- Row-level security for Build 4 tables (see 0002_row_level_security.sql for the helper functions).
ALTER TABLE "visitor_passes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY visitor_passes_estate ON "visitor_passes" FOR ALL USING (estate_id = app_estate_id() OR app_is_system()) WITH CHECK (estate_id = app_estate_id() OR app_is_system());
--> statement-breakpoint
ALTER TABLE "visits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY visits_estate ON "visits" FOR ALL USING (estate_id = app_estate_id() OR app_is_system()) WITH CHECK (estate_id = app_estate_id() OR app_is_system());
--> statement-breakpoint
ALTER TABLE "blocked_visitors" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY blocked_visitors_estate ON "blocked_visitors" FOR ALL USING (estate_id = app_estate_id() OR app_is_system()) WITH CHECK (estate_id = app_estate_id() OR app_is_system());
--> statement-breakpoint
ALTER TABLE "gate_code_attempts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY gate_code_attempts_estate ON "gate_code_attempts" FOR ALL USING (estate_id = app_estate_id() OR app_is_system()) WITH CHECK (estate_id = app_estate_id() OR app_is_system());
--> statement-breakpoint
-- Notifications: the recipient can read and mark their own across estates; writes happen in the estate's context
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notifications_read ON "notifications" FOR SELECT USING (user_id = app_user_id() OR estate_id = app_estate_id() OR app_is_system());
--> statement-breakpoint
CREATE POLICY notifications_update_own ON "notifications" FOR UPDATE USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY notifications_write ON "notifications" FOR ALL USING (estate_id = app_estate_id() OR app_is_system()) WITH CHECK (estate_id = app_estate_id() OR app_is_system());
