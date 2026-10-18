CREATE TABLE "packed_crowded_tiles" (
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"refund" jsonb NOT NULL,
	"packed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "packed_crowded_tiles_map_id_user_id_pk" PRIMARY KEY("map_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "packed_crowded_tiles" ADD CONSTRAINT "packed_crowded_tiles_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;