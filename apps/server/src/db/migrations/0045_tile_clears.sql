CREATE TABLE "tile_clears" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tile_id" uuid NOT NULL,
	"from_terrain" text NOT NULL,
	"from_node" text,
	"tool" text NOT NULL,
	"drop" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ready_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	CONSTRAINT "tile_clears_ready_after_start" CHECK ("tile_clears"."ready_at" >= "tile_clears"."started_at"),
	CONSTRAINT "tile_clears_end_reason" CHECK (("tile_clears"."ended_at" is null and "tile_clears"."end_reason" is null) or ("tile_clears"."ended_at" is not null and "tile_clears"."end_reason" in ('cleared', 'lost')))
);
--> statement-breakpoint
CREATE TABLE "tile_use_notes" (
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"moved" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"packed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"refund" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stopped_gatherers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"noted_at" timestamp with time zone NOT NULL,
	"seen_at" timestamp with time zone,
	CONSTRAINT "tile_use_notes_map_id_user_id_pk" PRIMARY KEY("map_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "tile_clears" ADD CONSTRAINT "tile_clears_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tile_clears" ADD CONSTRAINT "tile_clears_tile_id_tiles_id_fk" FOREIGN KEY ("tile_id") REFERENCES "public"."tiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tile_clears" ADD CONSTRAINT "tile_clears_member_fk" FOREIGN KEY ("map_id","user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tile_use_notes" ADD CONSTRAINT "tile_use_notes_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tile_clears_one_active_per_tile_key" ON "tile_clears" USING btree ("tile_id") WHERE "tile_clears"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "tile_clears_one_active_per_player_key" ON "tile_clears" USING btree ("map_id","user_id") WHERE "tile_clears"."ended_at" is null;