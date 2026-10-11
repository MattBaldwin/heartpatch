CREATE TYPE "public"."challenge_kind" AS ENUM('friendly', 'defense');--> statement-breakpoint
CREATE TYPE "public"."challenge_status" AS ENUM('pending', 'accepted', 'declined', 'cancelled', 'expired');--> statement-breakpoint
ALTER TYPE "public"."battle_kind" ADD VALUE 'friendly';--> statement-breakpoint
CREATE TABLE "challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"kind" "challenge_kind" NOT NULL,
	"status" "challenge_status" DEFAULT 'pending' NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"team" jsonb,
	"battle_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	CONSTRAINT "challenges_not_self" CHECK ("challenges"."from_user_id" <> "challenges"."to_user_id")
);
--> statement-breakpoint
CREATE TABLE "live_battles" (
	"battle_id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"b_user_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"picks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"grace_used_a" boolean DEFAULT false NOT NULL,
	"grace_used_b" boolean DEFAULT false NOT NULL,
	"cover_policy_a" text NOT NULL,
	"cover_policy_b" text NOT NULL,
	"covered" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "maps" ADD COLUMN "friendly_challenges" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_battle_id_battles_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_from_member_fk" FOREIGN KEY ("map_id","from_user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_to_member_fk" FOREIGN KEY ("map_id","to_user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_battles" ADD CONSTRAINT "live_battles_battle_id_battles_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_battles" ADD CONSTRAINT "live_battles_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_battles" ADD CONSTRAINT "live_battles_b_member_fk" FOREIGN KEY ("map_id","b_user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "challenges_one_pending_from_key" ON "challenges" USING btree ("map_id","from_user_id") WHERE "challenges"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "challenges_map_id_to_user_id_idx" ON "challenges" USING btree ("map_id","to_user_id","created_at");--> statement-breakpoint
CREATE INDEX "challenges_map_id_from_user_id_idx" ON "challenges" USING btree ("map_id","from_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "live_battles_one_active_b_key" ON "live_battles" USING btree ("map_id","b_user_id") WHERE "live_battles"."active";