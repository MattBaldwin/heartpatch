ALTER TABLE "squishies" ADD COLUMN "training_building_id" uuid;--> statement-breakpoint
ALTER TABLE "squishies" ADD COLUMN "training_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "squishies" ADD CONSTRAINT "squishies_training_building_id_buildings_id_fk" FOREIGN KEY ("training_building_id") REFERENCES "public"."buildings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "squishies_training_building_id_idx" ON "squishies" USING btree ("training_building_id") WHERE "squishies"."training_building_id" is not null;--> statement-breakpoint
ALTER TABLE "squishies" ADD CONSTRAINT "squishies_training_since" CHECK ("squishies"."training_building_id" is null or "squishies"."training_since" is not null);