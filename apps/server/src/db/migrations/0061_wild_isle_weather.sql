CREATE TABLE "weather_days" (
	"map_id" uuid NOT NULL,
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"fronts" jsonb NOT NULL,
	"planned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weather_days_map_id_day_pk" PRIMARY KEY("map_id","day")
);
--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "damaged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "damaged_by" text;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "weather_checked_through" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "weather_days" ADD CONSTRAINT "weather_days_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;