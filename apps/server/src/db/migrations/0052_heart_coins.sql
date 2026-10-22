CREATE TABLE "heart_coin_balances" (
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "heart_coin_balances_map_id_user_id_pk" PRIMARY KEY("map_id","user_id"),
	CONSTRAINT "heart_coin_balances_balance_nonnegative" CHECK ("heart_coin_balances"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "heart_coin_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"map_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "heart_coin_ledger_amount_nonzero" CHECK ("heart_coin_ledger"."amount" <> 0)
);
--> statement-breakpoint
ALTER TABLE "heart_coin_balances" ADD CONSTRAINT "heart_coin_balances_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heart_coin_balances" ADD CONSTRAINT "heart_coin_balances_member_fk" FOREIGN KEY ("map_id","user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heart_coin_ledger" ADD CONSTRAINT "heart_coin_ledger_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heart_coin_ledger" ADD CONSTRAINT "heart_coin_ledger_member_fk" FOREIGN KEY ("map_id","user_id") REFERENCES "public"."map_members"("map_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "heart_coin_ledger_source_ref_id_key" ON "heart_coin_ledger" USING btree ("source","ref_id");--> statement-breakpoint
CREATE INDEX "heart_coin_ledger_map_id_user_id_day_idx" ON "heart_coin_ledger" USING btree ("map_id","user_id","day","source");