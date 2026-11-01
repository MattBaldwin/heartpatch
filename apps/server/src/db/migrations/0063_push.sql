CREATE TABLE "push_sends" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"map_id" uuid,
	"claimed_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"devices" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "push_sends_user_id_kind_dedupe_key_key" UNIQUE("user_id","kind","dedupe_key"),
	CONSTRAINT "push_sends_kind_known" CHECK ("push_sends"."kind" in ('dusk', 'gatherers', 'friend', 'long-night-soon', 'long-night-start')),
	CONSTRAINT "push_sends_devices_nonnegative" CHECK ("push_sends"."devices" >= 0),
	CONSTRAINT "push_sends_dedupe_key_length" CHECK (length("push_sends"."dedupe_key") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "push_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"dusk" boolean DEFAULT true NOT NULL,
	"gatherers" boolean DEFAULT true NOT NULL,
	"friend" boolean DEFAULT true NOT NULL,
	"long_night" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_ok_at" timestamp with time zone,
	"fail_count" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE("endpoint"),
	CONSTRAINT "push_subscriptions_endpoint_https" CHECK ("push_subscriptions"."endpoint" like 'https://%' and length("push_subscriptions"."endpoint") <= 2048),
	CONSTRAINT "push_subscriptions_fail_count_nonnegative" CHECK ("push_subscriptions"."fail_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "push_sends" ADD CONSTRAINT "push_sends_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_settings" ADD CONSTRAINT "push_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_sends_user_id_claimed_at_idx" ON "push_sends" USING btree ("user_id","claimed_at");--> statement-breakpoint
CREATE INDEX "push_sends_claimed_at_idx" ON "push_sends" USING btree ("claimed_at");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions" USING btree ("user_id");