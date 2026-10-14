CREATE TYPE "public"."pass_status" AS ENUM('active', 'used', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."pass_usage" AS ENUM('single', 'multi');--> statement-breakpoint
CREATE TYPE "public"."visit_kind" AS ENUM('pass', 'walk_in');--> statement-breakpoint
CREATE TYPE "public"."visit_status" AS ENUM('awaiting_resident', 'approved', 'declined', 'denied', 'checked_in', 'checked_out', 'cancelled');--> statement-breakpoint
CREATE TABLE "blocked_visitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"estate_id" uuid NOT NULL,
	"name" text,
	"phone" text,
	"reason" text NOT NULL,
	"created_by" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gate_code_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"estate_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"user_id" uuid,
	"success" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"estate_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visitor_passes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"estate_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"visitor_name" text NOT NULL,
	"visitor_phone" text,
	"purpose" text DEFAULT '' NOT NULL,
	"vehicle_plate" text,
	"code" text NOT NULL,
	"usage" "pass_usage" DEFAULT 'single' NOT NULL,
	"uses_count" integer DEFAULT 0 NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"status" "pass_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"estate_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"pass_id" uuid,
	"kind" "visit_kind" NOT NULL,
	"status" "visit_status" NOT NULL,
	"visitor_name" text NOT NULL,
	"visitor_phone" text,
	"vehicle_plate" text,
	"purpose" text DEFAULT '' NOT NULL,
	"gate" integer DEFAULT 1 NOT NULL,
	"note" text,
	"logged_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"checked_in_at" timestamp with time zone,
	"checked_in_by" uuid,
	"checked_out_at" timestamp with time zone,
	"checked_out_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blocked_visitors" ADD CONSTRAINT "blocked_visitors_estate_id_estates_id_fk" FOREIGN KEY ("estate_id") REFERENCES "public"."estates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_visitors" ADD CONSTRAINT "blocked_visitors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_code_attempts" ADD CONSTRAINT "gate_code_attempts_estate_id_estates_id_fk" FOREIGN KEY ("estate_id") REFERENCES "public"."estates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_code_attempts" ADD CONSTRAINT "gate_code_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_estate_id_estates_id_fk" FOREIGN KEY ("estate_id") REFERENCES "public"."estates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_passes" ADD CONSTRAINT "visitor_passes_estate_id_estates_id_fk" FOREIGN KEY ("estate_id") REFERENCES "public"."estates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_passes" ADD CONSTRAINT "visitor_passes_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_passes" ADD CONSTRAINT "visitor_passes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_estate_id_estates_id_fk" FOREIGN KEY ("estate_id") REFERENCES "public"."estates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_pass_id_visitor_passes_id_fk" FOREIGN KEY ("pass_id") REFERENCES "public"."visitor_passes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_logged_by_users_id_fk" FOREIGN KEY ("logged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_checked_in_by_users_id_fk" FOREIGN KEY ("checked_in_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_checked_out_by_users_id_fk" FOREIGN KEY ("checked_out_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gate_code_attempts_device_idx" ON "gate_code_attempts" USING btree ("estate_id","device_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "visitor_passes_active_code" ON "visitor_passes" USING btree ("estate_id","code") WHERE "visitor_passes"."status" = 'active';--> statement-breakpoint
CREATE INDEX "visitor_passes_unit_idx" ON "visitor_passes" USING btree ("unit_id","created_at");--> statement-breakpoint
CREATE INDEX "visitor_passes_creator_day_idx" ON "visitor_passes" USING btree ("created_by","created_at");--> statement-breakpoint
CREATE INDEX "visits_estate_created_idx" ON "visits" USING btree ("estate_id","created_at");--> statement-breakpoint
CREATE INDEX "visits_estate_status_idx" ON "visits" USING btree ("estate_id","status");--> statement-breakpoint
CREATE INDEX "visits_unit_idx" ON "visits" USING btree ("unit_id","created_at");