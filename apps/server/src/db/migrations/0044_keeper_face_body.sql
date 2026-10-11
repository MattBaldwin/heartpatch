-- Face shape and body type (#372). Every row saved before is filled from its
-- base (the starting look), whose face and body share its id, so no Keeper
-- changes.
ALTER TABLE "keepers" ADD COLUMN "face" text;--> statement-breakpoint
ALTER TABLE "keepers" ADD COLUMN "body" text;--> statement-breakpoint
UPDATE "keepers" SET "face" = "base", "body" = "base";--> statement-breakpoint
ALTER TABLE "keepers" ALTER COLUMN "face" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "keepers" ALTER COLUMN "body" SET NOT NULL;
