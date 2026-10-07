CREATE TABLE "packed_home_fires" (
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"refund" jsonb NOT NULL,
	"packed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "packed_home_fires_map_id_user_id_pk" PRIMARY KEY("map_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "tile_attacks" ADD COLUMN "lost_fire_refund" jsonb;--> statement-breakpoint
ALTER TABLE "tile_tending" ADD COLUMN "lost_fire_refund" jsonb;--> statement-breakpoint
ALTER TABLE "packed_home_fires" ADD CONSTRAINT "packed_home_fires_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "buildings_one_fire_per_tile_key" ON "buildings" USING btree ("tile_id","building_id") WHERE "buildings"."kind" = 'hearthfire';