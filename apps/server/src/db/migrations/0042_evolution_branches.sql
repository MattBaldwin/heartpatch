ALTER TABLE "squishies" ADD COLUMN "habitat_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "squishies" ADD COLUMN "feeling_lean" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "squishies" ADD COLUMN "feeling_lean_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "squishies" ADD COLUMN "care_sum" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "squishies" ADD COLUMN "care_samples" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "squishy_evolutions" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "squishy_evolutions" ADD COLUMN "branch" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "squishy_evolutions" ADD COLUMN "roll" jsonb;--> statement-breakpoint
ALTER TABLE "squishy_evolutions" ADD CONSTRAINT "squishy_evolutions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "squishy_evolutions_user_rolls_idx" ON "squishy_evolutions" USING btree ("user_id","evolved_at") WHERE "squishy_evolutions"."roll" is not null;--> statement-breakpoint
-- #32: squishies already housed start counting habitat time now.
UPDATE "squishies" SET "habitat_since" = now() WHERE "habitat_building_id" IS NOT NULL;
