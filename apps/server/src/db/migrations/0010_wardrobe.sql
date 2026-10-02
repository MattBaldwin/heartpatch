CREATE TABLE "clothing_owned" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"source" text NOT NULL,
	"ref_id" uuid,
	"map_id" uuid,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outfits" (
	"user_id" uuid NOT NULL,
	"preset" smallint NOT NULL,
	"name" text,
	"wearing" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outfits_user_id_preset_pk" PRIMARY KEY("user_id","preset"),
	CONSTRAINT "outfits_preset_range" CHECK ("outfits"."preset" between 0 and 3)
);
--> statement-breakpoint
CREATE TABLE "squishy_accessories" (
	"squishy_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clothing_owned" ADD CONSTRAINT "clothing_owned_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clothing_owned" ADD CONSTRAINT "clothing_owned_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outfits" ADD CONSTRAINT "outfits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squishy_accessories" ADD CONSTRAINT "squishy_accessories_squishy_id_squishies_id_fk" FOREIGN KEY ("squishy_id") REFERENCES "public"."squishies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squishy_accessories" ADD CONSTRAINT "squishy_accessories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clothing_owned_user_id_item_id_idx" ON "clothing_owned" USING btree ("user_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clothing_owned_source_ref_id_key" ON "clothing_owned" USING btree ("source","ref_id") WHERE "clothing_owned"."ref_id" is not null;