CREATE TYPE "public"."gather_status" AS ENUM('active', 'collected', 'lost');--> statement-breakpoint
CREATE TABLE "crafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"recipe_id" text NOT NULL,
	"items" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ready_at" timestamp with time zone NOT NULL,
	"collected_at" timestamp with time zone,
	CONSTRAINT "crafts_ready_after_start" CHECK ("crafts"."ready_at" >= "crafts"."started_at")
);
--> statement-breakpoint
CREATE TABLE "gathers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tile_id" uuid NOT NULL,
	"resource" text NOT NULL,
	"items" jsonb NOT NULL,
	"status" "gather_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ready_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "gathers_ready_after_start" CHECK ("gathers"."ready_at" >= "gathers"."started_at")
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_map_id_user_id_item_id_pk" PRIMARY KEY("map_id","user_id","item_id"),
	CONSTRAINT "inventory_items_quantity_nonnegative" CHECK ("inventory_items"."quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "crafts" ADD CONSTRAINT "crafts_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crafts" ADD CONSTRAINT "crafts_member_fk" FOREIGN KEY ("map_id","user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gathers" ADD CONSTRAINT "gathers_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gathers" ADD CONSTRAINT "gathers_tile_id_tiles_id_fk" FOREIGN KEY ("tile_id") REFERENCES "public"."tiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gathers" ADD CONSTRAINT "gathers_member_fk" FOREIGN KEY ("map_id","user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_member_fk" FOREIGN KEY ("map_id","user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crafts_one_active_key" ON "crafts" USING btree ("map_id","user_id") WHERE "crafts"."collected_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "gathers_one_active_per_tile_key" ON "gathers" USING btree ("tile_id") WHERE "gathers"."status" = 'active';--> statement-breakpoint
CREATE INDEX "gathers_map_id_user_id_idx" ON "gathers" USING btree ("map_id","user_id");