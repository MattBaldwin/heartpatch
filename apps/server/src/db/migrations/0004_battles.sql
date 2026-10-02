CREATE TYPE "public"."battle_kind" AS ENUM('wild');--> statement-breakpoint
CREATE TYPE "public"."battle_status" AS ENUM('active', 'finished', 'no-contest');--> statement-breakpoint
CREATE TABLE "battles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"kind" "battle_kind" NOT NULL,
	"status" "battle_status" DEFAULT 'active' NOT NULL,
	"player_user_id" uuid NOT NULL,
	"seed" text NOT NULL,
	"content_hash" text NOT NULL,
	"setup" jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" jsonb NOT NULL,
	"result" jsonb,
	"log" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"scope" text NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" smallint,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_player_member_fk" FOREIGN KEY ("map_id","player_user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "battles_one_active_key" ON "battles" USING btree ("map_id","player_user_id") WHERE "battles"."status" = 'active';--> statement-breakpoint
CREATE INDEX "battles_map_id_player_user_id_idx" ON "battles" USING btree ("map_id","player_user_id");--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys" USING btree ("created_at");