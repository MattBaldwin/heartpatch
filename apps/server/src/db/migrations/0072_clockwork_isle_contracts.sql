ALTER TYPE "public"."patch_type" ADD VALUE 'clockwork-isle';--> statement-breakpoint
CREATE TABLE "research_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"building_id" uuid,
	"node_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ready_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	CONSTRAINT "research_jobs_ready_after_start" CHECK ("research_jobs"."ready_at" >= "research_jobs"."started_at"),
	CONSTRAINT "research_jobs_claimed_when_ready" CHECK ("research_jobs"."claimed_at" is null or "research_jobs"."claimed_at" >= "research_jobs"."ready_at")
);
--> statement-breakpoint
CREATE TABLE "research_known" (
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"known_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_known_map_id_user_id_node_id_pk" PRIMARY KEY("map_id","user_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "tile_lines" (
	"tile_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"map_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"level" smallint DEFAULT 1 NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tile_lines_tile_id_kind_pk" PRIMARY KEY("tile_id","kind"),
	CONSTRAINT "tile_lines_kind_known" CHECK ("tile_lines"."kind" in ('wire', 'rail')),
	CONSTRAINT "tile_lines_level" CHECK ("tile_lines"."level" between 1 and 2)
);
--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "unpowered_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tiles" ADD COLUMN "wind" smallint;--> statement-breakpoint
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_member_fk" FOREIGN KEY ("map_id","user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_known" ADD CONSTRAINT "research_known_member_fk" FOREIGN KEY ("map_id","user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tile_lines" ADD CONSTRAINT "tile_lines_tile_id_tiles_id_fk" FOREIGN KEY ("tile_id") REFERENCES "public"."tiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tile_lines" ADD CONSTRAINT "tile_lines_owner_member_fk" FOREIGN KEY ("map_id","owner_user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "research_jobs_one_going_key" ON "research_jobs" USING btree ("map_id","user_id") WHERE "research_jobs"."claimed_at" is null;--> statement-breakpoint
CREATE INDEX "tile_lines_map_id_owner_user_id_idx" ON "tile_lines" USING btree ("map_id","owner_user_id");--> statement-breakpoint
ALTER TABLE "tiles" ADD CONSTRAINT "tiles_wind_range" CHECK ("tiles"."wind" between 1 and 3);