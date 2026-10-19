CREATE TABLE "communities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"name" text NOT NULL,
	"restored_name" text,
	"named_at_level" smallint,
	"kind" text NOT NULL,
	"perk_id" text NOT NULL,
	"seed" text NOT NULL,
	"owner_user_id" uuid,
	"claimed_at" timestamp with time zone,
	"seed_tile_id" uuid NOT NULL,
	"key_tile_id" uuid NOT NULL,
	"key_revealed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communities_seed_tile_id_key" UNIQUE("seed_tile_id")
);
--> statement-breakpoint
CREATE TABLE "community_pieces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tile_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"pieces" integer NOT NULL,
	"paid" jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "community_pieces_pieces_positive" CHECK ("community_pieces"."pieces" >= 1)
);
--> statement-breakpoint
CREATE TABLE "community_tiles" (
	"community_id" uuid NOT NULL,
	"tile_id" uuid NOT NULL,
	"pieces_needed" integer NOT NULL,
	"pieces_done" integer DEFAULT 0 NOT NULL,
	"restored_by" uuid,
	"restored_at" timestamp with time zone,
	"cellar" boolean DEFAULT false NOT NULL,
	"cellar_opened_at" timestamp with time zone,
	"puzzle_solved_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "community_tiles_community_id_tile_id_pk" PRIMARY KEY("community_id","tile_id"),
	CONSTRAINT "community_tiles_tile_id_key" UNIQUE("tile_id"),
	CONSTRAINT "community_tiles_pieces_needed_positive" CHECK ("community_tiles"."pieces_needed" >= 1),
	CONSTRAINT "community_tiles_pieces_done_range" CHECK ("community_tiles"."pieces_done" between 0 and "community_tiles"."pieces_needed")
);
--> statement-breakpoint
ALTER TABLE "tiles" ADD COLUMN "community_id" uuid;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_seed_tile_id_tiles_id_fk" FOREIGN KEY ("seed_tile_id") REFERENCES "public"."tiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_key_tile_id_tiles_id_fk" FOREIGN KEY ("key_tile_id") REFERENCES "public"."tiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_pieces" ADD CONSTRAINT "community_pieces_tile_id_community_tiles_tile_id_fk" FOREIGN KEY ("tile_id") REFERENCES "public"."community_tiles"("tile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_pieces" ADD CONSTRAINT "community_pieces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_tiles" ADD CONSTRAINT "community_tiles_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_tiles" ADD CONSTRAINT "community_tiles_tile_id_tiles_id_fk" FOREIGN KEY ("tile_id") REFERENCES "public"."tiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_tiles" ADD CONSTRAINT "community_tiles_restored_by_users_id_fk" FOREIGN KEY ("restored_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "communities_map_id_idx" ON "communities" USING btree ("map_id");--> statement-breakpoint
CREATE INDEX "community_pieces_tile_id_idx" ON "community_pieces" USING btree ("tile_id");--> statement-breakpoint
ALTER TABLE "tiles" ADD CONSTRAINT "tiles_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tiles_community_id_idx" ON "tiles" USING btree ("community_id");