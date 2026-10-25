CREATE TYPE "public"."patch_type" AS ENUM('cozy', 'wild-isle');--> statement-breakpoint
ALTER TABLE "maps" ADD COLUMN "patch_type" "patch_type" DEFAULT 'cozy' NOT NULL;--> statement-breakpoint
ALTER TABLE "tiles" ADD COLUMN "isle" smallint;