ALTER TABLE "squishies" ADD COLUMN "contentment" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "squishies" ADD COLUMN "contentment_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "squishies" ADD CONSTRAINT "squishies_contentment_checkpoint_range" CHECK ("squishies"."contentment" between 0 and 100);