CREATE TYPE "public"."journey_kind" AS ENUM('post', 'far-hollow');--> statement-breakpoint
CREATE TABLE "far_hollow_explore" (
	"user_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"season_seed" text NOT NULL,
	"tile_index" smallint NOT NULL,
	"searched" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "far_hollow_explore_user_id_map_id_season_seed_tile_index_pk" PRIMARY KEY("user_id","map_id","season_seed","tile_index"),
	CONSTRAINT "far_hollow_explore_tile_index_range" CHECK ("far_hollow_explore"."tile_index" between 0 and 31),
	CONSTRAINT "far_hollow_explore_searched_range" CHECK ("far_hollow_explore"."searched" >= 0)
);
--> statement-breakpoint
ALTER TABLE "journeys" ADD COLUMN "kind" "journey_kind" DEFAULT 'post' NOT NULL;--> statement-breakpoint
ALTER TABLE "far_hollow_explore" ADD CONSTRAINT "far_hollow_explore_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_far_hollow_no_visit" CHECK ("journeys"."kind" = 'post' or "journeys"."visit_until" is null);