ALTER TYPE "public"."battle_kind" ADD VALUE 'miniboss';--> statement-breakpoint
CREATE TABLE "boss_bonds" (
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"species_id" text NOT NULL,
	"misses" integer DEFAULT 0 NOT NULL,
	"squishy_id" uuid,
	"befriended_at" timestamp with time zone,
	CONSTRAINT "boss_bonds_map_id_user_id_species_id_pk" PRIMARY KEY("map_id","user_id","species_id"),
	CONSTRAINT "boss_bonds_misses_nonnegative" CHECK ("boss_bonds"."misses" >= 0)
);
--> statement-breakpoint
CREATE TABLE "boss_encounters" (
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"window_id" date NOT NULL,
	"won_battle_id" uuid,
	"asks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "boss_encounters_map_id_user_id_window_id_pk" PRIMARY KEY("map_id","user_id","window_id")
);
--> statement-breakpoint
CREATE TABLE "boss_windows" (
	"map_id" uuid NOT NULL,
	"window_id" date NOT NULL,
	"species_id" text NOT NULL,
	"q" smallint NOT NULL,
	"r" smallint NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	CONSTRAINT "boss_windows_map_id_window_id_pk" PRIMARY KEY("map_id","window_id"),
	CONSTRAINT "boss_windows_ends_after_opens" CHECK ("boss_windows"."ends_at" > "boss_windows"."opens_at")
);
--> statement-breakpoint
ALTER TABLE "boss_bonds" ADD CONSTRAINT "boss_bonds_squishy_id_squishies_id_fk" FOREIGN KEY ("squishy_id") REFERENCES "public"."squishies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boss_bonds" ADD CONSTRAINT "boss_bonds_member_fk" FOREIGN KEY ("map_id","user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boss_encounters" ADD CONSTRAINT "boss_encounters_won_battle_id_battles_id_fk" FOREIGN KEY ("won_battle_id") REFERENCES "public"."battles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boss_encounters" ADD CONSTRAINT "boss_encounters_member_fk" FOREIGN KEY ("map_id","user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boss_encounters" ADD CONSTRAINT "boss_encounters_window_fk" FOREIGN KEY ("map_id","window_id") REFERENCES "public"."boss_windows"("map_id","window_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boss_windows" ADD CONSTRAINT "boss_windows_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;