CREATE TABLE "long_nights" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"night" date NOT NULL,
	"ran_at" timestamp with time zone NOT NULL,
	"strike_at" timestamp with time zone NOT NULL,
	"held" boolean NOT NULL,
	"outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"keeper_of_night_user_id" uuid,
	"gap_opens_at" timestamp with time zone,
	"gap_closes_at" timestamp with time zone,
	"seed" text NOT NULL,
	"content_hash" text NOT NULL,
	CONSTRAINT "long_nights_map_id_night_key" UNIQUE("map_id","night"),
	CONSTRAINT "long_nights_gap_window" CHECK (("long_nights"."gap_opens_at" is null and "long_nights"."gap_closes_at" is null) or ("long_nights"."gap_opens_at" is not null and "long_nights"."gap_closes_at" is not null and "long_nights"."gap_opens_at" < "long_nights"."gap_closes_at")),
	CONSTRAINT "long_nights_gap_only_when_held" CHECK ("long_nights"."held" or "long_nights"."gap_opens_at" is null)
);
--> statement-breakpoint
ALTER TABLE "maps" ADD COLUMN "long_night_weekday" smallint DEFAULT 6;--> statement-breakpoint
ALTER TABLE "long_nights" ADD CONSTRAINT "long_nights_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "long_nights_map_id_gap_closes_at_idx" ON "long_nights" USING btree ("map_id","gap_closes_at");--> statement-breakpoint
ALTER TABLE "maps" ADD CONSTRAINT "maps_long_night_weekday_range" CHECK ("maps"."long_night_weekday" between 0 and 6);