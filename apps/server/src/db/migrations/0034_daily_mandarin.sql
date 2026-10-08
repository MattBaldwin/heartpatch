-- The Keeper builder (#289). Every row saved before it is filled from its base
-- (the starting look), so no Keeper changes; the values are KEEPER_DATA's.
ALTER TABLE "keepers" ADD COLUMN "skin_tone" text;--> statement-breakpoint
ALTER TABLE "keepers" ADD COLUMN "eyes" text;--> statement-breakpoint
ALTER TABLE "keepers" ADD COLUMN "brows" text;--> statement-breakpoint
ALTER TABLE "keepers" ADD COLUMN "mouth" text;--> statement-breakpoint
ALTER TABLE "keepers" ADD COLUMN "extras" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
UPDATE "keepers" SET
  "skin_tone" = CASE "base" WHEN 'pip' THEN 'tone-1' WHEN 'clover' THEN 'tone-3' WHEN 'rowan' THEN 'tone-10' WHEN 'maple' THEN 'tone-4' WHEN 'basil' THEN 'tone-5' WHEN 'wren' THEN 'tone-6' WHEN 'acorn' THEN 'tone-8' WHEN 'bramble' THEN 'tone-7' WHEN 'sunny' THEN 'tone-9' WHEN 'juniper' THEN 'tone-2' WHEN 'hazel' THEN 'tone-10' WHEN 'moss' THEN 'tone-9' ELSE 'tone-1' END,
  "eyes" = CASE "base" WHEN 'pip' THEN 'round' WHEN 'clover' THEN 'oval' WHEN 'rowan' THEN 'oval' WHEN 'maple' THEN 'happy' WHEN 'basil' THEN 'happy' WHEN 'wren' THEN 'round' WHEN 'acorn' THEN 'round' WHEN 'bramble' THEN 'oval' WHEN 'sunny' THEN 'happy' WHEN 'juniper' THEN 'sleepy' WHEN 'hazel' THEN 'sleepy' WHEN 'moss' THEN 'round' ELSE 'round' END,
  "brows" = CASE "base" WHEN 'pip' THEN 'arched' WHEN 'clover' THEN 'arched' WHEN 'rowan' THEN 'arched' WHEN 'maple' THEN 'arched' WHEN 'basil' THEN 'arched' WHEN 'wren' THEN 'arched' WHEN 'acorn' THEN 'arched' WHEN 'bramble' THEN 'arched' WHEN 'sunny' THEN 'arched' WHEN 'juniper' THEN 'arched' WHEN 'hazel' THEN 'arched' WHEN 'moss' THEN 'arched' ELSE 'arched' END,
  "mouth" = CASE "base" WHEN 'pip' THEN 'smile' WHEN 'clover' THEN 'smile' WHEN 'rowan' THEN 'smile' WHEN 'maple' THEN 'smile' WHEN 'basil' THEN 'smile' WHEN 'wren' THEN 'smile' WHEN 'acorn' THEN 'smile' WHEN 'bramble' THEN 'smile' WHEN 'sunny' THEN 'smile' WHEN 'juniper' THEN 'smile' WHEN 'hazel' THEN 'smile' WHEN 'moss' THEN 'smile' ELSE 'smile' END;--> statement-breakpoint
ALTER TABLE "keepers" ALTER COLUMN "skin_tone" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "keepers" ALTER COLUMN "eyes" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "keepers" ALTER COLUMN "brows" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "keepers" ALTER COLUMN "mouth" SET NOT NULL;
