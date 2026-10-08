CREATE TYPE "public"."mailbox_kind" AS ENUM('trade', 'gift', 'return');--> statement-breakpoint
CREATE TYPE "public"."trade_kind" AS ENUM('trade', 'gift');--> statement-breakpoint
CREATE TYPE "public"."trade_line_kind" AS ENUM('squishy', 'item', 'clothing');--> statement-breakpoint
CREATE TYPE "public"."trade_side" AS ENUM('give', 'want');--> statement-breakpoint
CREATE TYPE "public"."trade_status" AS ENUM('open', 'accepted', 'declined', 'cancelled', 'expired', 'taken_back');--> statement-breakpoint
ALTER TYPE "public"."squishy_state" ADD VALUE 'in-trade';--> statement-breakpoint
CREATE TABLE "mailbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"kind" "mailbox_kind" NOT NULL,
	"lines" jsonb NOT NULL,
	"ready_at" timestamp with time zone NOT NULL,
	"picked_up_at" timestamp with time zone,
	"picked_up_post_tile_id" uuid
);
--> statement-breakpoint
CREATE TABLE "trade_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"event" text NOT NULL,
	"actor_user_id" uuid,
	"at" timestamp with time zone NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "trade_ledger_offer_event_actor_key" UNIQUE NULLS NOT DISTINCT("offer_id","event","actor_user_id")
);
--> statement-breakpoint
CREATE TABLE "trade_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"offer_id" uuid NOT NULL,
	"side" "trade_side" NOT NULL,
	"kind" "trade_line_kind" NOT NULL,
	"squishy_id" uuid,
	"item_id" text,
	"quantity" integer,
	"clothing_id" uuid,
	CONSTRAINT "trade_lines_one_target" CHECK (("trade_lines"."kind" = 'item' and "trade_lines"."item_id" is not null and "trade_lines"."quantity" > 0 and "trade_lines"."squishy_id" is null and "trade_lines"."clothing_id" is null)
        or ("trade_lines"."kind" = 'squishy' and "trade_lines"."item_id" is null and "trade_lines"."quantity" is null and "trade_lines"."clothing_id" is null)
        or ("trade_lines"."kind" = 'clothing' and "trade_lines"."item_id" is null and "trade_lines"."quantity" is null and "trade_lines"."squishy_id" is null))
);
--> statement-breakpoint
CREATE TABLE "trade_offers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"kind" "trade_kind" NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"status" "trade_status" DEFAULT 'open' NOT NULL,
	"note_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	"value_give" integer,
	"value_want" integer,
	"fair" boolean,
	"take_back_until" timestamp with time zone,
	"bonus_paid_at" timestamp with time zone,
	CONSTRAINT "trade_offers_two_players" CHECK ("trade_offers"."from_user_id" <> "trade_offers"."to_user_id")
);
--> statement-breakpoint
ALTER TABLE "clothing_owned" ADD COLUMN "held_by_offer_id" uuid;--> statement-breakpoint
ALTER TABLE "maps" ADD COLUMN "trading_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "mailbox" ADD CONSTRAINT "mailbox_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox" ADD CONSTRAINT "mailbox_offer_id_trade_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."trade_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox" ADD CONSTRAINT "mailbox_picked_up_post_tile_id_tiles_id_fk" FOREIGN KEY ("picked_up_post_tile_id") REFERENCES "public"."tiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_ledger" ADD CONSTRAINT "trade_ledger_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_ledger" ADD CONSTRAINT "trade_ledger_offer_id_trade_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."trade_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_lines" ADD CONSTRAINT "trade_lines_offer_id_trade_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."trade_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_lines" ADD CONSTRAINT "trade_lines_squishy_id_squishies_id_fk" FOREIGN KEY ("squishy_id") REFERENCES "public"."squishies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_lines" ADD CONSTRAINT "trade_lines_clothing_id_clothing_owned_id_fk" FOREIGN KEY ("clothing_id") REFERENCES "public"."clothing_owned"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_offers" ADD CONSTRAINT "trade_offers_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_offers" ADD CONSTRAINT "trade_offers_from_member_fk" FOREIGN KEY ("map_id","from_user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_offers" ADD CONSTRAINT "trade_offers_to_member_fk" FOREIGN KEY ("map_id","to_user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mailbox_waiting_idx" ON "mailbox" USING btree ("map_id","user_id") WHERE "mailbox"."picked_up_at" is null;--> statement-breakpoint
CREATE INDEX "mailbox_offer_id_idx" ON "mailbox" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "trade_lines_offer_id_idx" ON "trade_lines" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "trade_offers_map_id_to_user_id_status_idx" ON "trade_offers" USING btree ("map_id","to_user_id","status");--> statement-breakpoint
CREATE INDEX "trade_offers_map_id_from_user_id_status_idx" ON "trade_offers" USING btree ("map_id","from_user_id","status");--> statement-breakpoint
ALTER TABLE "clothing_owned" ADD CONSTRAINT "clothing_owned_held_by_offer_id_trade_offers_id_fk" FOREIGN KEY ("held_by_offer_id") REFERENCES "public"."trade_offers"("id") ON DELETE set null ON UPDATE no action;