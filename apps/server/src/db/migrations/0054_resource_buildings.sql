ALTER TABLE "buildings" ADD COLUMN "produced_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "upkeep_paid_through" date;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "upkeep_rank" smallint;