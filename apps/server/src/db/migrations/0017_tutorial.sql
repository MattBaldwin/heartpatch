CREATE TABLE "lore_found" (
	"user_id" uuid NOT NULL,
	"page_id" text NOT NULL,
	"map_id" uuid,
	"found_at" timestamp with time zone NOT NULL,
	CONSTRAINT "lore_found_user_id_page_id_pk" PRIMARY KEY("user_id","page_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "partner_species_id" text;--> statement-breakpoint
ALTER TABLE "lore_found" ADD CONSTRAINT "lore_found_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lore_found" ADD CONSTRAINT "lore_found_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE set null ON UPDATE no action;