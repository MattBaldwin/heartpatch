CREATE TYPE "public"."map_kind" AS ENUM('multiplayer', 'tutorial');--> statement-breakpoint
CREATE TYPE "public"."map_member_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."map_member_status" AS ENUM('active', 'removed');--> statement-breakpoint
CREATE TYPE "public"."squishy_state" AS ENUM('active', 'hollowed');--> statement-breakpoint
CREATE TABLE "game_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"type" text NOT NULL,
	"actor_user_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_events_map_id_seq_key" UNIQUE("map_id","seq"),
	CONSTRAINT "game_events_seq_positive" CHECK ("game_events"."seq" >= 1)
);
--> statement-breakpoint
CREATE TABLE "map_members" (
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "map_member_role" NOT NULL,
	"status" "map_member_status" DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "map_members_map_id_user_id_pk" PRIMARY KEY("map_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "maps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "map_kind" NOT NULL,
	"name" text NOT NULL,
	"time_zone" text NOT NULL,
	"event_seq" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maps_event_seq_nonnegative" CHECK ("maps"."event_seq" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "squishies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"species_id" text NOT NULL,
	"element" text NOT NULL,
	"feeling" text NOT NULL,
	"nickname" text,
	"level" integer DEFAULT 1 NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"state" "squishy_state" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "squishies_level_positive" CHECK ("squishies"."level" >= 1),
	CONSTRAINT "squishies_xp_nonnegative" CHECK ("squishies"."xp" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"q" smallint NOT NULL,
	"r" smallint NOT NULL,
	"terrain" text NOT NULL,
	"owner_user_id" uuid,
	CONSTRAINT "tiles_map_id_q_r_key" UNIQUE("map_id","q","r")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"birth_year" smallint NOT NULL,
	"tutorial_step" text,
	"tutorial_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_birth_year_range" CHECK ("users"."birth_year" between 1900 and 2100)
);
--> statement-breakpoint
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_members" ADD CONSTRAINT "map_members_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_members" ADD CONSTRAINT "map_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squishies" ADD CONSTRAINT "squishies_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squishies" ADD CONSTRAINT "squishies_owner_member_fk" FOREIGN KEY ("map_id","owner_user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiles" ADD CONSTRAINT "tiles_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiles" ADD CONSTRAINT "tiles_owner_member_fk" FOREIGN KEY ("map_id","owner_user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "map_members_user_id_idx" ON "map_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "map_members_one_owner_key" ON "map_members" USING btree ("map_id") WHERE "map_members"."role" = 'owner';--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "squishies_map_id_owner_user_id_idx" ON "squishies" USING btree ("map_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "tiles_map_id_owner_user_id_idx" ON "tiles" USING btree ("map_id","owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_key" ON "users" USING btree (lower("username"));