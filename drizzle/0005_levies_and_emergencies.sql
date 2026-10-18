CREATE TYPE "public"."charge_kind" AS ENUM('security_levy', 'service_charge');--> statement-breakpoint
CREATE TYPE "public"."distress_status" AS ENUM('active', 'acknowledged', 'resolved', 'false_alarm');--> statement-breakpoint
CREATE TYPE "public"."location_source" AS ENUM('gps', 'estate', 'none');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('bank_transfer', 'cash', 'pos', 'online', 'other');--> statement-breakpoint
CREATE TABLE "distress_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"estate_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"raised_by" uuid NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"accuracy_meters" integer,
	"location_source" "location_source" NOT NULL,
	"status" "distress_status" DEFAULT 'active' NOT NULL,
	"notified_count" integer DEFAULT 0 NOT NULL,
	"acknowledged_by" uuid,
	"acknowledged_at" timestamp with time zone,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"closing_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "levy_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"estate_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"kind" charge_kind NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"period" text NOT NULL,
	"paid_on" date NOT NULL,
	"method" "payment_method" DEFAULT 'bank_transfer' NOT NULL,
	"reference" text,
	"payer_name" text,
	"note" text,
	"recorded_by" uuid,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "police_stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"area" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"phone" text NOT NULL,
	"alt_phone" text,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "estates" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "estates" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "distress_alerts" ADD CONSTRAINT "distress_alerts_estate_id_estates_id_fk" FOREIGN KEY ("estate_id") REFERENCES "public"."estates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distress_alerts" ADD CONSTRAINT "distress_alerts_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distress_alerts" ADD CONSTRAINT "distress_alerts_raised_by_users_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distress_alerts" ADD CONSTRAINT "distress_alerts_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distress_alerts" ADD CONSTRAINT "distress_alerts_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "levy_payments" ADD CONSTRAINT "levy_payments_estate_id_estates_id_fk" FOREIGN KEY ("estate_id") REFERENCES "public"."estates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "levy_payments" ADD CONSTRAINT "levy_payments_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "levy_payments" ADD CONSTRAINT "levy_payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "levy_payments" ADD CONSTRAINT "levy_payments_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "distress_alerts_estate_created_idx" ON "distress_alerts" USING btree ("estate_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "distress_alerts_one_open_per_unit" ON "distress_alerts" USING btree ("unit_id") WHERE "distress_alerts"."status" in ('active', 'acknowledged');--> statement-breakpoint
CREATE INDEX "levy_payments_estate_paid_idx" ON "levy_payments" USING btree ("estate_id","paid_on");--> statement-breakpoint
CREATE INDEX "levy_payments_unit_idx" ON "levy_payments" USING btree ("unit_id","paid_on");