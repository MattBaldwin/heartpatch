CREATE TABLE "event_consumers" (
	"consumer" text NOT NULL,
	"map_id" uuid NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "event_consumers_consumer_map_id_pk" PRIMARY KEY("consumer","map_id"),
	CONSTRAINT "event_consumers_last_seq_nonnegative" CHECK ("event_consumers"."last_seq" >= 0)
);
--> statement-breakpoint
ALTER TABLE "event_consumers" ADD CONSTRAINT "event_consumers_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;