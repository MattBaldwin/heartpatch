CREATE TABLE "coin_balances" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coin_balances_balance_nonnegative" CHECK ("coin_balances"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "coin_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"map_id" uuid,
	"day" date NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "coin_ledger_amount_nonzero" CHECK ("coin_ledger"."amount" <> 0)
);
--> statement-breakpoint
ALTER TABLE "coin_balances" ADD CONSTRAINT "coin_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_ledger" ADD CONSTRAINT "coin_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_ledger" ADD CONSTRAINT "coin_ledger_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coin_ledger_source_ref_id_key" ON "coin_ledger" USING btree ("source","ref_id");--> statement-breakpoint
CREATE INDEX "coin_ledger_user_id_day_idx" ON "coin_ledger" USING btree ("user_id","day","source");