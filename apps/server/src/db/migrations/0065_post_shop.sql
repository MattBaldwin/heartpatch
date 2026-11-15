CREATE TABLE "post_purchases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"price" integer NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_battle_id" uuid,
	CONSTRAINT "post_purchases_price_positive" CHECK ("post_purchases"."price" > 0)
);
--> statement-breakpoint
ALTER TABLE "post_purchases" ADD CONSTRAINT "post_purchases_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_purchases" ADD CONSTRAINT "post_purchases_consumed_battle_id_battles_id_fk" FOREIGN KEY ("consumed_battle_id") REFERENCES "public"."battles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_purchases" ADD CONSTRAINT "post_purchases_member_fk" FOREIGN KEY ("map_id","user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_purchases_caps_idx" ON "post_purchases" USING btree ("map_id","user_id","item_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "post_purchases_one_lure_held" ON "post_purchases" USING btree ("map_id","user_id") WHERE "post_purchases"."item_id" = 'rare-lure' and "post_purchases"."consumed_at" is null;