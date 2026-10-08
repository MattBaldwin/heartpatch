CREATE TABLE "tile_explore" (
	"user_id" uuid NOT NULL,
	"tile_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"layout" smallint NOT NULL,
	"terrain" text NOT NULL,
	"searched" integer DEFAULT 0 NOT NULL,
	"spot_count" smallint NOT NULL,
	"completed_at" timestamp with time zone,
	"joined_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"resumed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tile_explore_user_id_tile_id_pk" PRIMARY KEY("user_id","tile_id"),
	CONSTRAINT "tile_explore_spot_count_range" CHECK ("tile_explore"."spot_count" between 1 and 30),
	CONSTRAINT "tile_explore_searched_range" CHECK ("tile_explore"."searched" >= 0),
	CONSTRAINT "tile_explore_homestead_after_explored" CHECK (("tile_explore"."joined_at" is null or "tile_explore"."completed_at" is not null) and ("tile_explore"."paused_at" is null or "tile_explore"."joined_at" is not null) and ("tile_explore"."resumed_at" is null or "tile_explore"."paused_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "tile_explore" ADD CONSTRAINT "tile_explore_tile_id_tiles_id_fk" FOREIGN KEY ("tile_id") REFERENCES "public"."tiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tile_explore_map_id_user_id_explored_idx" ON "tile_explore" USING btree ("map_id","user_id") WHERE "tile_explore"."completed_at" is not null;