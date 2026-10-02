CREATE TABLE "buildings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"tile_id" uuid NOT NULL,
	"building_id" text NOT NULL,
	"kind" text NOT NULL,
	"level" smallint DEFAULT 1 NOT NULL,
	"spot" smallint NOT NULL,
	"fuelled_through" date,
	"fuel_updated_at" timestamp with time zone,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buildings_tile_id_spot_key" UNIQUE("tile_id","spot"),
	CONSTRAINT "buildings_level_positive" CHECK ("buildings"."level" >= 1),
	CONSTRAINT "buildings_spot_range" CHECK ("buildings"."spot" between 0 and 6)
);
--> statement-breakpoint
ALTER TABLE "squishies" ADD COLUMN "habitat_building_id" uuid;--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_tile_id_tiles_id_fk" FOREIGN KEY ("tile_id") REFERENCES "public"."tiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_owner_member_fk" FOREIGN KEY ("map_id","owner_user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "buildings_map_id_owner_user_id_idx" ON "buildings" USING btree ("map_id","owner_user_id");--> statement-breakpoint
ALTER TABLE "squishies" ADD CONSTRAINT "squishies_habitat_building_id_buildings_id_fk" FOREIGN KEY ("habitat_building_id") REFERENCES "public"."buildings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "squishies_habitat_building_id_idx" ON "squishies" USING btree ("habitat_building_id");