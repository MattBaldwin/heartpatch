CREATE TABLE "keepers" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"base" text NOT NULL,
	"hair_color" text NOT NULL,
	"eye_color" text NOT NULL,
	"outfit" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "keepers" ADD CONSTRAINT "keepers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;