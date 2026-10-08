CREATE TABLE "packed_training_grounds" (
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"refund" jsonb NOT NULL,
	"packed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "packed_training_grounds_map_id_user_id_pk" PRIMARY KEY("map_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "maps" ADD COLUMN "hollow_strength_percent" smallint DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "tile_tending" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "packed_training_grounds" ADD CONSTRAINT "packed_training_grounds_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maps" ADD CONSTRAINT "maps_hollow_strength_range" CHECK ("maps"."hollow_strength_percent" between 0 and 300);