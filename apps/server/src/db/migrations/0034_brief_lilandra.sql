CREATE TYPE "public"."journey_outcome" AS ENUM('active', 'won', 'lost', 'no-contest');--> statement-breakpoint
ALTER TYPE "public"."battle_kind" ADD VALUE 'journey';--> statement-breakpoint
CREATE TABLE "journeys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"post_tile_id" uuid NOT NULL,
	"battle_id" uuid NOT NULL,
	"distance" smallint NOT NULL,
	"level" smallint NOT NULL,
	"team_size" smallint NOT NULL,
	"outcome" "journey_outcome" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"visit_until" timestamp with time zone,
	CONSTRAINT "journeys_battle_id_key" UNIQUE("battle_id"),
	CONSTRAINT "journeys_distance_positive" CHECK ("journeys"."distance" >= 1),
	CONSTRAINT "journeys_visit_won" CHECK ("journeys"."visit_until" is null or "journeys"."outcome" = 'won')
);
--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_post_tile_id_tiles_id_fk" FOREIGN KEY ("post_tile_id") REFERENCES "public"."tiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_battle_id_battles_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_user_member_fk" FOREIGN KEY ("map_id","user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journeys_map_id_user_id_post_tile_id_idx" ON "journeys" USING btree ("map_id","user_id","post_tile_id","visit_until");