CREATE TYPE "public"."join_request_status" AS ENUM('pending', 'approved', 'denied');--> statement-breakpoint
CREATE TYPE "public"."pvp_mode" AS ENUM('on', 'gentle', 'off');--> statement-breakpoint
CREATE TABLE "invite_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "invite_codes_code_key" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "join_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"invite_code_id" uuid NOT NULL,
	"status" "join_request_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "map_members" ADD COLUMN "home_slot" smallint;--> statement-breakpoint
ALTER TABLE "maps" ADD COLUMN "max_players" smallint DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "maps" ADD COLUMN "pvp_mode" "pvp_mode" DEFAULT 'gentle' NOT NULL;--> statement-breakpoint
ALTER TABLE "maps" ADD COLUMN "seed" text;--> statement-breakpoint
ALTER TABLE "tiles" ADD COLUMN "node_resource" text;--> statement-breakpoint
ALTER TABLE "tiles" ADD COLUMN "guardian_strength" smallint;--> statement-breakpoint
ALTER TABLE "tiles" ADD COLUMN "home_slot" smallint;--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_invite_code_id_invite_codes_id_fk" FOREIGN KEY ("invite_code_id") REFERENCES "public"."invite_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invite_codes_one_live_key" ON "invite_codes" USING btree ("map_id") WHERE "invite_codes"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "join_requests_one_pending_key" ON "join_requests" USING btree ("map_id","user_id") WHERE "join_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "join_requests_user_id_idx" ON "join_requests" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "map_members_active_home_slot_key" ON "map_members" USING btree ("map_id","home_slot") WHERE "map_members"."status" = 'active';--> statement-breakpoint
ALTER TABLE "map_members" ADD CONSTRAINT "map_members_home_slot_nonnegative" CHECK ("map_members"."home_slot" >= 0);--> statement-breakpoint
ALTER TABLE "maps" ADD CONSTRAINT "maps_max_players_range" CHECK ("maps"."max_players" between 1 and 4);