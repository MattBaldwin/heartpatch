ALTER TABLE "squishies" ADD COLUMN "team_slot" smallint;--> statement-breakpoint
ALTER TABLE "squishies" ADD COLUMN "work_tile_id" uuid;--> statement-breakpoint
ALTER TABLE "squishies" ADD COLUMN "work_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "squishies" ADD COLUMN "work_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "squishies" ADD CONSTRAINT "squishies_work_tile_id_tiles_id_fk" FOREIGN KEY ("work_tile_id") REFERENCES "public"."tiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "squishies_team_slot_key" ON "squishies" USING btree ("map_id","owner_user_id","team_slot") WHERE "squishies"."team_slot" is not null;--> statement-breakpoint
CREATE INDEX "squishies_work_tile_id_idx" ON "squishies" USING btree ("work_tile_id") WHERE "squishies"."work_tile_id" is not null;--> statement-breakpoint
ALTER TABLE "squishies" ADD CONSTRAINT "squishies_team_slot_range" CHECK ("squishies"."team_slot" between 0 and 5);--> statement-breakpoint
ALTER TABLE "squishies" ADD CONSTRAINT "squishies_one_job" CHECK ("squishies"."team_slot" is null or "squishies"."work_tile_id" is null);--> statement-breakpoint
ALTER TABLE "squishies" ADD CONSTRAINT "squishies_work_times" CHECK ("squishies"."work_tile_id" is null or ("squishies"."work_since" is not null and "squishies"."work_started_at" is not null));