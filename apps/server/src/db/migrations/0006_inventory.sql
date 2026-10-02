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
CREATE TABLE "gather_jobs" (
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
	CONSTRAINT "gather_jobs_ready_after_start" CHECK ("gather_jobs"."ready_at" >= "gather_jobs"."started_at")
);
--> statement-breakpoint
CREATE TABLE "inventories" (
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventories_map_id_user_id_item_id_pk" PRIMARY KEY("map_id","user_id","item_id"),
	CONSTRAINT "inventories_quantity_nonnegative" CHECK ("inventories"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "resource_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"ref_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_ledger_delta_nonzero" CHECK ("resource_ledger"."delta" <> 0)
);
--> statement-breakpoint
ALTER TABLE "crafts" ADD CONSTRAINT "crafts_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crafts" ADD CONSTRAINT "crafts_member_fk" FOREIGN KEY ("map_id","user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gather_jobs" ADD CONSTRAINT "gather_jobs_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gather_jobs" ADD CONSTRAINT "gather_jobs_tile_id_tiles_id_fk" FOREIGN KEY ("tile_id") REFERENCES "public"."tiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gather_jobs" ADD CONSTRAINT "gather_jobs_member_fk" FOREIGN KEY ("map_id","user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventories" ADD CONSTRAINT "inventories_member_fk" FOREIGN KEY ("map_id","user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_ledger" ADD CONSTRAINT "resource_ledger_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_ledger" ADD CONSTRAINT "resource_ledger_member_fk" FOREIGN KEY ("map_id","user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crafts_one_active_key" ON "crafts" USING btree ("map_id","user_id") WHERE "crafts"."collected_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "gather_jobs_one_active_per_tile_key" ON "gather_jobs" USING btree ("tile_id") WHERE "gather_jobs"."status" = 'active';--> statement-breakpoint
CREATE INDEX "gather_jobs_map_id_user_id_idx" ON "gather_jobs" USING btree ("map_id","user_id");--> statement-breakpoint
CREATE INDEX "resource_ledger_map_id_user_id_idx" ON "resource_ledger" USING btree ("map_id","user_id");