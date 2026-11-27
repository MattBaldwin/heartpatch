CREATE TABLE "boss_bar_chips" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"window_id" date NOT NULL,
	"user_id" uuid NOT NULL,
	"battle_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "boss_bar_chips_battle_id_key" UNIQUE("battle_id"),
	CONSTRAINT "boss_bar_chips_points_nonnegative" CHECK ("boss_bar_chips"."points" >= 0)
);
--> statement-breakpoint
CREATE TABLE "boss_bars" (
	"map_id" uuid NOT NULL,
	"window_id" date NOT NULL,
	"goal" integer NOT NULL,
	"chipped" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"head_start" integer DEFAULT 0 NOT NULL,
	"head_start_lights" smallint DEFAULT 0 NOT NULL,
	"head_start_star" boolean DEFAULT false NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"fell_at" timestamp with time zone,
	CONSTRAINT "boss_bars_map_id_window_id_pk" PRIMARY KEY("map_id","window_id"),
	CONSTRAINT "boss_bars_state_known" CHECK ("boss_bars"."state" in ('open', 'fell', 'dozed')),
	CONSTRAINT "boss_bars_goal_positive" CHECK ("boss_bars"."goal" > 0),
	CONSTRAINT "boss_bars_head_start_in_chipped" CHECK ("boss_bars"."head_start" >= 0 and "boss_bars"."chipped" >= "boss_bars"."head_start"),
	CONSTRAINT "boss_bars_head_start_lights_nonnegative" CHECK ("boss_bars"."head_start_lights" >= 0),
	CONSTRAINT "boss_bars_closes_after_opens" CHECK ("boss_bars"."closes_at" > "boss_bars"."opens_at"),
	CONSTRAINT "boss_bars_fell_at_when_fell" CHECK (("boss_bars"."state" = 'fell') = ("boss_bars"."fell_at" is not null)),
	CONSTRAINT "boss_bars_fell_when_full" CHECK ("boss_bars"."state" <> 'fell' or "boss_bars"."chipped" >= "boss_bars"."goal"),
	CONSTRAINT "boss_bars_dozed_when_short" CHECK ("boss_bars"."state" <> 'dozed' or "boss_bars"."chipped" < "boss_bars"."goal")
);
--> statement-breakpoint
ALTER TABLE "boss_encounters" ADD COLUMN "thanked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "boss_windows" ADD COLUMN "kind" text DEFAULT 'weekly' NOT NULL;--> statement-breakpoint
ALTER TABLE "boss_bar_chips" ADD CONSTRAINT "boss_bar_chips_battle_id_battles_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boss_bar_chips" ADD CONSTRAINT "boss_bar_chips_bar_fk" FOREIGN KEY ("map_id","window_id") REFERENCES "public"."boss_bars"("map_id","window_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boss_bar_chips" ADD CONSTRAINT "boss_bar_chips_member_fk" FOREIGN KEY ("map_id","user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boss_bars" ADD CONSTRAINT "boss_bars_window_fk" FOREIGN KEY ("map_id","window_id") REFERENCES "public"."boss_windows"("map_id","window_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boss_bar_chips_window_user_idx" ON "boss_bar_chips" USING btree ("map_id","window_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "boss_windows_one_christmas_eve_key" ON "boss_windows" USING btree ("map_id",extract(year from "window_id")) WHERE "boss_windows"."kind" = 'christmas-eve';--> statement-breakpoint
ALTER TABLE "boss_windows" ADD CONSTRAINT "boss_windows_kind_known" CHECK ("boss_windows"."kind" in ('weekly', 'christmas-eve'));