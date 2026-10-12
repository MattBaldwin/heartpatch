CREATE TABLE "house_gifts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"giver_squishy_id" uuid,
	"item_id" text NOT NULL,
	"count" smallint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	CONSTRAINT "house_gifts_map_id_user_id_day_key" UNIQUE("map_id","user_id","day"),
	CONSTRAINT "house_gifts_count_positive" CHECK ("house_gifts"."count" >= 1)
);
--> statement-breakpoint
CREATE TABLE "house_residents" (
	"squishy_id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"room_id" text,
	"moved_in_at" timestamp with time zone,
	"moved_out_at" timestamp with time zone,
	CONSTRAINT "house_residents_in_or_out" CHECK (("house_residents"."room_id" is null) = ("house_residents"."moved_in_at" is null))
);
--> statement-breakpoint
CREATE TABLE "keeper_houses" (
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"level" smallint DEFAULT 1 NOT NULL,
	"built_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "keeper_houses_map_id_user_id_pk" PRIMARY KEY("map_id","user_id"),
	CONSTRAINT "keeper_houses_level_positive" CHECK ("keeper_houses"."level" >= 1)
);
--> statement-breakpoint
ALTER TABLE "house_gifts" ADD CONSTRAINT "house_gifts_giver_squishy_id_squishies_id_fk" FOREIGN KEY ("giver_squishy_id") REFERENCES "public"."squishies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "house_gifts" ADD CONSTRAINT "house_gifts_house_fk" FOREIGN KEY ("map_id","user_id") REFERENCES "public"."keeper_houses"("map_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "house_residents" ADD CONSTRAINT "house_residents_squishy_id_squishies_id_fk" FOREIGN KEY ("squishy_id") REFERENCES "public"."squishies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keeper_houses" ADD CONSTRAINT "keeper_houses_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keeper_houses" ADD CONSTRAINT "keeper_houses_member_fk" FOREIGN KEY ("map_id","user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "house_residents_map_id_user_id_idx" ON "house_residents" USING btree ("map_id","user_id") WHERE "house_residents"."room_id" is not null;