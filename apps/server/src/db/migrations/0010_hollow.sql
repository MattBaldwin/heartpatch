CREATE TYPE "public"."hollow_rescue_outcome" AS ENUM('active', 'rescued', 'lost', 'no-contest');--> statement-breakpoint
ALTER TYPE "public"."battle_kind" ADD VALUE 'rescue';--> statement-breakpoint
CREATE TABLE "hollow_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"night" date NOT NULL,
	"ran_at" timestamp with time zone NOT NULL,
	"outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "hollow_events_map_id_night_key" UNIQUE("map_id","night")
);
--> statement-breakpoint
CREATE TABLE "hollow_rescues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"squishy_id" uuid NOT NULL,
	"battle_id" uuid NOT NULL,
	"outcome" "hollow_rescue_outcome" DEFAULT 'active' NOT NULL,
	"heartdust" smallint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "hollow_rescues_battle_id_key" UNIQUE("battle_id"),
	CONSTRAINT "hollow_rescues_heartdust_nonnegative" CHECK ("hollow_rescues"."heartdust" >= 0)
);
--> statement-breakpoint
ALTER TABLE "hollow_events" ADD CONSTRAINT "hollow_events_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hollow_rescues" ADD CONSTRAINT "hollow_rescues_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hollow_rescues" ADD CONSTRAINT "hollow_rescues_squishy_id_squishies_id_fk" FOREIGN KEY ("squishy_id") REFERENCES "public"."squishies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hollow_rescues" ADD CONSTRAINT "hollow_rescues_battle_id_battles_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hollow_rescues" ADD CONSTRAINT "hollow_rescues_user_member_fk" FOREIGN KEY ("map_id","user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hollow_rescues_map_id_user_id_idx" ON "hollow_rescues" USING btree ("map_id","user_id","ended_at");--> statement-breakpoint
CREATE INDEX "hollow_rescues_squishy_id_idx" ON "hollow_rescues" USING btree ("squishy_id");