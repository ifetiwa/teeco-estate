ALTER TABLE "police_stations" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "estates" ADD COLUMN "police_station_id" uuid;--> statement-breakpoint
ALTER TABLE "police_stations" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "police_stations" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "estates" ADD CONSTRAINT "estates_police_station_id_police_stations_id_fk" FOREIGN KEY ("police_station_id") REFERENCES "public"."police_stations"("id") ON DELETE set null ON UPDATE no action;