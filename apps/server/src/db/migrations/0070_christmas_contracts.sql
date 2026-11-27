CREATE TABLE "advent_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"map_id" uuid,
	"seed" text NOT NULL,
	"result" jsonb NOT NULL,
	"catch_up" boolean DEFAULT false NOT NULL,
	"claimed_on" date NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "advent_claims_user_id_day_key" UNIQUE("user_id","day"),
	CONSTRAINT "advent_claims_day_in_advent" CHECK (extract(month from "advent_claims"."day") = 12 and extract(day from "advent_claims"."day") between 1 and 25),
	CONSTRAINT "advent_claims_claimed_on_after_day" CHECK ("advent_claims"."claimed_on" >= "advent_claims"."day"),
	CONSTRAINT "advent_claims_catch_up_late" CHECK ("advent_claims"."catch_up" = ("advent_claims"."claimed_on" > "advent_claims"."day"))
);
--> statement-breakpoint
CREATE TABLE "keeper_warmth" (
	"map_id" uuid NOT NULL,
	"user_a_id" uuid NOT NULL,
	"user_b_id" uuid NOT NULL,
	"warmth" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "keeper_warmth_pkey" PRIMARY KEY("map_id","user_a_id","user_b_id"),
	CONSTRAINT "keeper_warmth_pair_ordered" CHECK ("keeper_warmth"."user_a_id" < "keeper_warmth"."user_b_id"),
	CONSTRAINT "keeper_warmth_nonnegative" CHECK ("keeper_warmth"."warmth" >= 0)
);
--> statement-breakpoint
CREATE TABLE "patch_trees" (
	"map_id" uuid PRIMARY KEY NOT NULL,
	"post_tile_id" uuid NOT NULL,
	"ornaments" integer DEFAULT 0 NOT NULL,
	"star_lit_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patch_trees_ornaments_nonnegative" CHECK ("patch_trees"."ornaments" >= 0)
);
--> statement-breakpoint
ALTER TABLE "push_sends" DROP CONSTRAINT "push_sends_kind_known";--> statement-breakpoint
ALTER TABLE "push_settings" ADD COLUMN "christmas" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "advent_claims" ADD CONSTRAINT "advent_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advent_claims" ADD CONSTRAINT "advent_claims_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keeper_warmth" ADD CONSTRAINT "keeper_warmth_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keeper_warmth" ADD CONSTRAINT "keeper_warmth_a_member_fk" FOREIGN KEY ("map_id","user_a_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keeper_warmth" ADD CONSTRAINT "keeper_warmth_b_member_fk" FOREIGN KEY ("map_id","user_b_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patch_trees" ADD CONSTRAINT "patch_trees_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patch_trees" ADD CONSTRAINT "patch_trees_post_tile_id_tiles_id_fk" FOREIGN KEY ("post_tile_id") REFERENCES "public"."tiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "advent_claims_user_id_claimed_on_catch_up_key" ON "advent_claims" USING btree ("user_id","claimed_on") WHERE "advent_claims"."catch_up";--> statement-breakpoint
ALTER TABLE "push_sends" ADD CONSTRAINT "push_sends_kind_known" CHECK ("push_sends"."kind" in ('dusk', 'gatherers', 'friend', 'long-night-soon', 'long-night-start', 'present', 'christmas-eve'));