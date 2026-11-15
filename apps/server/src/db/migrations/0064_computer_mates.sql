CREATE TYPE "public"."user_kind" AS ENUM('player', 'computer');--> statement-breakpoint
CREATE TABLE "computer_mates" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"persona_id" text NOT NULL,
	"seed" text NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"next_act_at" timestamp with time zone,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "computer_mates_map_id_persona_id_key" UNIQUE("map_id","persona_id"),
	CONSTRAINT "computer_mates_step_nonnegative" CHECK ("computer_mates"."step" >= 0)
);
--> statement-breakpoint
DROP INDEX "users_username_lower_key";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "birth_year" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "maps" ADD COLUMN "computer_mates" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "maps" ADD COLUMN "computer_mates_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "maps" ADD COLUMN "keepers_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "kind" "user_kind" DEFAULT 'player' NOT NULL;--> statement-breakpoint
ALTER TABLE "computer_mates" ADD CONSTRAINT "computer_mates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "computer_mates" ADD CONSTRAINT "computer_mates_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "computer_mates_due_idx" ON "computer_mates" USING btree ("next_act_at") WHERE "computer_mates"."next_act_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_key" ON "users" USING btree (lower("username")) WHERE "users"."kind" = 'player';--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_kind_credentials_check" CHECK (("users"."kind" = 'player' and "users"."password_hash" is not null and "users"."birth_year" is not null) or ("users"."kind" = 'computer' and "users"."password_hash" is null));