CREATE TYPE "public"."defense_stance" AS ENUM('aggressive', 'defensive', 'balanced');--> statement-breakpoint
CREATE TYPE "public"."raid_outcome" AS ENUM('held', 'tie', 'lost', 'taken', 'no-contest');--> statement-breakpoint
CREATE TABLE "raids" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"battle_id" uuid NOT NULL,
	"tile_id" uuid NOT NULL,
	"attacker_user_id" uuid NOT NULL,
	"defender_user_id" uuid NOT NULL,
	"outcome" "raid_outcome" NOT NULL,
	"reason" text NOT NULL,
	"stance" "defense_stance",
	"resolved_at" timestamp with time zone NOT NULL,
	"seen_at" timestamp with time zone,
	CONSTRAINT "raids_battle_id_key" UNIQUE("battle_id")
);
--> statement-breakpoint
ALTER TABLE "map_members" ADD COLUMN "defense_stance" "defense_stance" DEFAULT 'balanced' NOT NULL;--> statement-breakpoint
ALTER TABLE "raids" ADD CONSTRAINT "raids_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raids" ADD CONSTRAINT "raids_battle_id_battles_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raids" ADD CONSTRAINT "raids_tile_id_tiles_id_fk" FOREIGN KEY ("tile_id") REFERENCES "public"."tiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raids" ADD CONSTRAINT "raids_defender_member_fk" FOREIGN KEY ("map_id","defender_user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "raids_map_id_defender_idx" ON "raids" USING btree ("map_id","defender_user_id","resolved_at");