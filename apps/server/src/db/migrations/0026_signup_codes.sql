CREATE TABLE "signup_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"label" text NOT NULL,
	"created_by_user_id" uuid,
	"max_uses" integer NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "signup_codes_code_hash_key" UNIQUE("code_hash"),
	CONSTRAINT "signup_codes_use_count_range" CHECK ("signup_codes"."use_count" between 0 and "signup_codes"."max_uses")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "signup_code_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invited_by" uuid;--> statement-breakpoint
ALTER TABLE "signup_codes" ADD CONSTRAINT "signup_codes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signup_codes_created_by_user_id_idx" ON "signup_codes" USING btree ("created_by_user_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_signup_code_id_signup_codes_id_fk" FOREIGN KEY ("signup_code_id") REFERENCES "public"."signup_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;