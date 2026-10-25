CREATE TABLE "tile_roads" (
	"tile_id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"level" smallint NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tile_roads_level" CHECK ("tile_roads"."level" between 1 and 3)
);
--> statement-breakpoint
ALTER TABLE "tile_tending" ADD COLUMN "stranded_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tile_roads" ADD CONSTRAINT "tile_roads_tile_id_tiles_id_fk" FOREIGN KEY ("tile_id") REFERENCES "public"."tiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tile_roads" ADD CONSTRAINT "tile_roads_owner_member_fk" FOREIGN KEY ("map_id","owner_user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tile_roads_map_id_owner_user_id_idx" ON "tile_roads" USING btree ("map_id","owner_user_id");