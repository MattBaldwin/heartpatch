CREATE TABLE "care_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"squishy_id" uuid NOT NULL,
	"action" text NOT NULL,
	"day" date NOT NULL,
	"gained" integer NOT NULL,
	"full" boolean NOT NULL,
	"coins" integer NOT NULL,
	"cared_at" timestamp with time zone NOT NULL,
	CONSTRAINT "care_log_gained_nonnegative" CHECK ("care_log"."gained" >= 0),
	CONSTRAINT "care_log_coins_nonnegative" CHECK ("care_log"."coins" >= 0)
);
--> statement-breakpoint
CREATE TABLE "squishy_evolutions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"squishy_id" uuid NOT NULL,
	"from_species_id" text NOT NULL,
	"into_species_id" text NOT NULL,
	"level" integer NOT NULL,
	"evolved_at" timestamp with time zone NOT NULL,
	"seen_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "squishies" ADD COLUMN "contentment_at_last_care" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "squishies" ADD COLUMN "last_cared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "care_log" ADD CONSTRAINT "care_log_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_log" ADD CONSTRAINT "care_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_log" ADD CONSTRAINT "care_log_squishy_id_squishies_id_fk" FOREIGN KEY ("squishy_id") REFERENCES "public"."squishies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squishy_evolutions" ADD CONSTRAINT "squishy_evolutions_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squishy_evolutions" ADD CONSTRAINT "squishy_evolutions_squishy_id_squishies_id_fk" FOREIGN KEY ("squishy_id") REFERENCES "public"."squishies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "care_log_squishy_id_day_idx" ON "care_log" USING btree ("squishy_id","day");--> statement-breakpoint
CREATE INDEX "care_log_user_id_day_idx" ON "care_log" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "squishy_evolutions_unseen_idx" ON "squishy_evolutions" USING btree ("squishy_id") WHERE "squishy_evolutions"."seen_at" is null;--> statement-breakpoint
ALTER TABLE "squishies" ADD CONSTRAINT "squishies_contentment_range" CHECK ("squishies"."contentment_at_last_care" between 0 and 100);