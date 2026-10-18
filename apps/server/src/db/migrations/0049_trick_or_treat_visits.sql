CREATE TABLE "trick_or_treat_visits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"visitor_user_id" uuid NOT NULL,
	"host_user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"lantern" boolean NOT NULL,
	"trick" boolean NOT NULL,
	"prize_kind" text NOT NULL,
	"prize_item_id" text NOT NULL,
	"prize_count" smallint NOT NULL,
	"host_heartdust" smallint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trick_or_treat_visits_once_a_day_key" UNIQUE("map_id","visitor_user_id","host_user_id","day"),
	CONSTRAINT "trick_or_treat_visits_not_self" CHECK ("trick_or_treat_visits"."visitor_user_id" <> "trick_or_treat_visits"."host_user_id"),
	CONSTRAINT "trick_or_treat_visits_prize_count_positive" CHECK ("trick_or_treat_visits"."prize_count" >= 1),
	CONSTRAINT "trick_or_treat_visits_host_heartdust_non_negative" CHECK ("trick_or_treat_visits"."host_heartdust" >= 0)
);
--> statement-breakpoint
ALTER TABLE "trick_or_treat_visits" ADD CONSTRAINT "trick_or_treat_visits_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trick_or_treat_visits" ADD CONSTRAINT "trick_or_treat_visits_visitor_user_id_users_id_fk" FOREIGN KEY ("visitor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trick_or_treat_visits" ADD CONSTRAINT "trick_or_treat_visits_host_user_id_users_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trick_or_treat_visits_host_idx" ON "trick_or_treat_visits" USING btree ("map_id","host_user_id","day");