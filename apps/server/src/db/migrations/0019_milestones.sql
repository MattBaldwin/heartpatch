CREATE TABLE "milestone_progress" (
	"user_id" uuid NOT NULL,
	"milestone_id" text NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"kinds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "milestone_progress_user_id_milestone_id_pk" PRIMARY KEY("user_id","milestone_id"),
	CONSTRAINT "milestone_progress_progress_nonnegative" CHECK ("milestone_progress"."progress" >= 0)
);
--> statement-breakpoint
CREATE TABLE "milestone_rewards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"milestone_id" text NOT NULL,
	"tier" smallint NOT NULL,
	"map_id" uuid,
	"earned_at" timestamp with time zone NOT NULL,
	"seen_at" timestamp with time zone,
	CONSTRAINT "milestone_rewards_tier_positive" CHECK ("milestone_rewards"."tier" >= 1)
);
--> statement-breakpoint
ALTER TABLE "keepers" ADD COLUMN "title_id" text;--> statement-breakpoint
ALTER TABLE "milestone_progress" ADD CONSTRAINT "milestone_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_rewards" ADD CONSTRAINT "milestone_rewards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_rewards" ADD CONSTRAINT "milestone_rewards_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "milestone_rewards_user_id_milestone_id_tier_key" ON "milestone_rewards" USING btree ("user_id","milestone_id","tier");--> statement-breakpoint
CREATE INDEX "milestone_rewards_unseen_idx" ON "milestone_rewards" USING btree ("user_id") WHERE "milestone_rewards"."seen_at" is null;