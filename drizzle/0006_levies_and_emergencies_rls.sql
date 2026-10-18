-- Row-level security for levy payments and distress alerts (see 0002_row_level_security.sql for the helper functions).
ALTER TABLE "levy_payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY levy_payments_estate ON "levy_payments" FOR ALL USING (estate_id = app_estate_id() OR app_is_system()) WITH CHECK (estate_id = app_estate_id() OR app_is_system());
--> statement-breakpoint
ALTER TABLE "distress_alerts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY distress_alerts_estate ON "distress_alerts" FOR ALL USING (estate_id = app_estate_id() OR app_is_system()) WITH CHECK (estate_id = app_estate_id() OR app_is_system());
--> statement-breakpoint
-- Money is never negative or zero
ALTER TABLE "levy_payments" ADD CONSTRAINT levy_payments_amount_positive CHECK (amount_kobo > 0);
