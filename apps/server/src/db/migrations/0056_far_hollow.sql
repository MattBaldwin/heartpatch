CREATE TYPE "public"."journey_kind" AS ENUM('post', 'far-hollow');--> statement-breakpoint
CREATE TABLE "far_hollow_rooms" (
	"user_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"season_seed" text NOT NULL,
	"room_id" text NOT NULL,
	"fixed" integer DEFAULT 0 NOT NULL,
	"bloomed_at" timestamp with time zone,
	CONSTRAINT "far_hollow_rooms_user_id_map_id_season_seed_room_id_pk" PRIMARY KEY("user_id","map_id","season_seed","room_id"),
	CONSTRAINT "far_hollow_rooms_fixed_range" CHECK ("far_hollow_rooms"."fixed" >= 0)
);
--> statement-breakpoint
CREATE TABLE "far_hollow_state" (
	"user_id" uuid NOT NULL,
	"map_id" uuid NOT NULL,
	"season_seed" text NOT NULL,
	"keys" integer DEFAULT 0 NOT NULL,
	"current_room" text,
	"last_lit_room" text,
	"bonus_open" integer DEFAULT 0 NOT NULL,
	"chests_opened" integer DEFAULT 0 NOT NULL,
	"arrived_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attic_opened_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "far_hollow_state_user_id_map_id_season_seed_pk" PRIMARY KEY("user_id","map_id","season_seed"),
	CONSTRAINT "far_hollow_state_bits" CHECK ("far_hollow_state"."keys" >= 0 and "far_hollow_state"."bonus_open" >= 0 and "far_hollow_state"."chests_opened" >= 0)
);
--> statement-breakpoint
ALTER TABLE "journeys" ADD COLUMN "kind" "journey_kind" DEFAULT 'post' NOT NULL;--> statement-breakpoint
ALTER TABLE "far_hollow_rooms" ADD CONSTRAINT "far_hollow_rooms_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "far_hollow_state" ADD CONSTRAINT "far_hollow_state_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_far_hollow_no_visit" CHECK ("journeys"."kind" = 'post' or "journeys"."visit_until" is null);