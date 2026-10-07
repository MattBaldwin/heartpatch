ALTER TABLE "tile_attacks" ADD COLUMN "lost_fire_refund" jsonb;--> statement-breakpoint
ALTER TABLE "tile_tending" ADD COLUMN "lost_fire_refund" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "buildings_one_fire_per_tile_key" ON "buildings" USING btree ("tile_id","building_id") WHERE "buildings"."kind" = 'hearthfire';