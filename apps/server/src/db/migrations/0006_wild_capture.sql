CREATE TABLE "species_seen" (
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"species_id" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"first_caught_at" timestamp with time zone,
	CONSTRAINT "species_seen_map_id_user_id_species_id_pk" PRIMARY KEY("map_id","user_id","species_id")
);
--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "spawn_q" smallint;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "spawn_r" smallint;--> statement-breakpoint
ALTER TABLE "battles" ADD COLUMN "spawn_window" text;--> statement-breakpoint
ALTER TABLE "species_seen" ADD CONSTRAINT "species_seen_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "species_seen" ADD CONSTRAINT "species_seen_member_fk" FOREIGN KEY ("map_id","user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "battles_spawn_window_idx" ON "battles" USING btree ("map_id","player_user_id","spawn_window") WHERE "battles"."spawn_window" is not null;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_spawn_all_or_none" CHECK (("battles"."spawn_window" is null) = ("battles"."spawn_q" is null) and ("battles"."spawn_window" is null) = ("battles"."spawn_r" is null));