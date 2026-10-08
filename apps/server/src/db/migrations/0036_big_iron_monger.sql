CREATE TYPE "public"."factory_queue_end" AS ENUM('done', 'stopped', 'taken-down');--> statement-breakpoint
CREATE TABLE "factory_queues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"recipe_id" text NOT NULL,
	"total" integer NOT NULL,
	"banked" integer DEFAULT 0 NOT NULL,
	"item_seconds" integer NOT NULL,
	"output" jsonb NOT NULL,
	"inputs" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" "factory_queue_end",
	CONSTRAINT "factory_queues_total_range" CHECK ("factory_queues"."total" between 1 and 9999),
	CONSTRAINT "factory_queues_banked_range" CHECK ("factory_queues"."banked" between 0 and "factory_queues"."total"),
	CONSTRAINT "factory_queues_item_seconds_positive" CHECK ("factory_queues"."item_seconds" > 0),
	CONSTRAINT "factory_queues_ended" CHECK (("factory_queues"."ended_at" is null) = ("factory_queues"."end_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "factory_queues" ADD CONSTRAINT "factory_queues_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_queues" ADD CONSTRAINT "factory_queues_member_fk" FOREIGN KEY ("map_id","user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "factory_queues_running_idx" ON "factory_queues" USING btree ("map_id","user_id") WHERE "factory_queues"."ended_at" is null;