CREATE TYPE "public"."account_helper_status" AS ENUM('pending', 'active', 'declined', 'removed');--> statement-breakpoint
CREATE TABLE "account_helper_resets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"helper_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_helpers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"helper_user_id" uuid NOT NULL,
	"status" "account_helper_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	CONSTRAINT "account_helpers_not_self" CHECK ("account_helpers"."user_id" <> "account_helpers"."helper_user_id")
);
--> statement-breakpoint
ALTER TABLE "account_helper_resets" ADD CONSTRAINT "account_helper_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_helper_resets" ADD CONSTRAINT "account_helper_resets_helper_user_id_users_id_fk" FOREIGN KEY ("helper_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_helpers" ADD CONSTRAINT "account_helpers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_helpers" ADD CONSTRAINT "account_helpers_helper_user_id_users_id_fk" FOREIGN KEY ("helper_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_helper_resets_helper_user_id_idx" ON "account_helper_resets" USING btree ("helper_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "account_helpers_one_live_key" ON "account_helpers" USING btree ("user_id","helper_user_id") WHERE "account_helpers"."status" in ('pending', 'active');--> statement-breakpoint
CREATE INDEX "account_helpers_user_id_idx" ON "account_helpers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "account_helpers_helper_user_id_idx" ON "account_helpers" USING btree ("helper_user_id");