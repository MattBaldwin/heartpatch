CREATE TABLE "fence_segments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"tile_id" uuid NOT NULL,
	"edge" smallint NOT NULL,
	"building_id" text NOT NULL,
	"level" smallint DEFAULT 1 NOT NULL,
	"hp" smallint NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fence_segments_tile_id_edge_key" UNIQUE("tile_id","edge"),
	CONSTRAINT "fence_segments_edge_range" CHECK ("fence_segments"."edge" between 0 and 5),
	CONSTRAINT "fence_segments_level_positive" CHECK ("fence_segments"."level" >= 1),
	CONSTRAINT "fence_segments_hp_positive" CHECK ("fence_segments"."hp" >= 1)
);
--> statement-breakpoint
ALTER TABLE "tile_attacks" ADD COLUMN "part" text DEFAULT 'guard' NOT NULL;--> statement-breakpoint
ALTER TABLE "tile_attacks" ADD COLUMN "follows_attack_id" uuid;--> statement-breakpoint
ALTER TABLE "tile_attacks" ADD COLUMN "fence_segment_id" uuid;--> statement-breakpoint
ALTER TABLE "tile_attacks" ADD COLUMN "fence_building_id" text;--> statement-breakpoint
ALTER TABLE "tile_attacks" ADD COLUMN "fence_hp_before" smallint;--> statement-breakpoint
ALTER TABLE "tile_attacks" ADD COLUMN "fence_max_hp" smallint;--> statement-breakpoint
ALTER TABLE "tile_attacks" ADD COLUMN "fence_hp_after" smallint;--> statement-breakpoint
ALTER TABLE "tile_attacks" ADD COLUMN "lost_fences" smallint;--> statement-breakpoint
ALTER TABLE "fence_segments" ADD CONSTRAINT "fence_segments_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fence_segments" ADD CONSTRAINT "fence_segments_tile_id_tiles_id_fk" FOREIGN KEY ("tile_id") REFERENCES "public"."tiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fence_segments" ADD CONSTRAINT "fence_segments_owner_member_fk" FOREIGN KEY ("map_id","owner_user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fence_segments_map_id_owner_user_id_idx" ON "fence_segments" USING btree ("map_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "tile_attacks_follows_attack_id_idx" ON "tile_attacks" USING btree ("follows_attack_id") WHERE "tile_attacks"."follows_attack_id" is not null;--> statement-breakpoint
ALTER TABLE "tile_attacks" ADD CONSTRAINT "tile_attacks_part" CHECK ("tile_attacks"."part" in ('fence', 'guard'));