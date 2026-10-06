CREATE TABLE "tile_tending" (
	"tile_id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"tended_at" timestamp with time zone NOT NULL,
	"wild_night" date,
	"wild_from_user_id" uuid,
	"wild_at" timestamp with time zone,
	CONSTRAINT "tile_tending_wild_set" CHECK (("tile_tending"."wild_night" is null) = ("tile_tending"."wild_from_user_id" is null) and ("tile_tending"."wild_night" is null) = ("tile_tending"."wild_at" is null))
);
--> statement-breakpoint
ALTER TABLE "tile_tending" ADD CONSTRAINT "tile_tending_tile_id_tiles_id_fk" FOREIGN KEY ("tile_id") REFERENCES "public"."tiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tile_tending_map_id_idx" ON "tile_tending" USING btree ("map_id");