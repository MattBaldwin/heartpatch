CREATE TYPE "public"."tile_attack_outcome" AS ENUM('active', 'captured', 'won', 'lost', 'no-contest');--> statement-breakpoint
ALTER TYPE "public"."battle_kind" ADD VALUE 'tile';--> statement-breakpoint
ALTER TYPE "public"."battle_kind" ADD VALUE 'rival-tile';--> statement-breakpoint
CREATE TABLE "tile_attacks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"tile_id" uuid NOT NULL,
	"attacker_user_id" uuid NOT NULL,
	"defender_user_id" uuid,
	"battle_id" uuid NOT NULL,
	"outcome" "tile_attack_outcome" DEFAULT 'active' NOT NULL,
	"reward_percent" smallint DEFAULT 100 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"cooldown_until" timestamp with time zone NOT NULL,
	"last_action_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "tile_attacks_battle_id_key" UNIQUE("battle_id"),
	CONSTRAINT "tile_attacks_reward_percent_range" CHECK ("tile_attacks"."reward_percent" between 0 and 100),
	CONSTRAINT "tile_attacks_cooldown_after_start" CHECK ("tile_attacks"."cooldown_until" >= "tile_attacks"."started_at")
);
--> statement-breakpoint
CREATE TABLE "tile_defenders" (
	"map_id" uuid NOT NULL,
	"tile_id" uuid NOT NULL,
	"slot" smallint NOT NULL,
	"squishy_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tile_defenders_tile_id_slot_pk" PRIMARY KEY("tile_id","slot"),
	CONSTRAINT "tile_defenders_squishy_id_key" UNIQUE("squishy_id"),
	CONSTRAINT "tile_defenders_slot_range" CHECK ("tile_defenders"."slot" between 0 and 5)
);
--> statement-breakpoint
ALTER TABLE "tile_attacks" ADD CONSTRAINT "tile_attacks_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tile_attacks" ADD CONSTRAINT "tile_attacks_tile_id_tiles_id_fk" FOREIGN KEY ("tile_id") REFERENCES "public"."tiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tile_attacks" ADD CONSTRAINT "tile_attacks_battle_id_battles_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tile_attacks" ADD CONSTRAINT "tile_attacks_attacker_member_fk" FOREIGN KEY ("map_id","attacker_user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tile_defenders" ADD CONSTRAINT "tile_defenders_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tile_defenders" ADD CONSTRAINT "tile_defenders_tile_id_tiles_id_fk" FOREIGN KEY ("tile_id") REFERENCES "public"."tiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tile_defenders" ADD CONSTRAINT "tile_defenders_squishy_id_squishies_id_fk" FOREIGN KEY ("squishy_id") REFERENCES "public"."squishies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tile_attacks_map_id_attacker_idx" ON "tile_attacks" USING btree ("map_id","attacker_user_id","started_at");--> statement-breakpoint
CREATE INDEX "tile_attacks_tile_id_idx" ON "tile_attacks" USING btree ("tile_id","cooldown_until");--> statement-breakpoint
CREATE INDEX "tile_attacks_map_id_defender_idx" ON "tile_attacks" USING btree ("map_id","defender_user_id","ended_at") WHERE "tile_attacks"."defender_user_id" is not null;--> statement-breakpoint
CREATE INDEX "tile_defenders_map_id_idx" ON "tile_defenders" USING btree ("map_id");