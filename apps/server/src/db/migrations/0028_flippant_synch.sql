ALTER TABLE "squishies" ADD COLUMN "joined_level" integer;--> statement-breakpoint
-- Hand-added backfill (#205; re-add it when regenerating): a befriended
-- squishy joined at the level its `squishy.captured` event recorded; any
-- other squishy from before this column counts from its level now, so no
-- meter jumps to "almost evolved" by mistake (owner decision 2026-10-07).
UPDATE "squishies" AS s SET "joined_level" = COALESCE(
  (
    SELECT MIN((e."payload"->>'level')::integer)
    FROM "game_events" AS e
    WHERE e."map_id" = s."map_id"
      AND e."type" = 'squishy.captured'
      AND e."payload"->>'squishyId' = s."id"::text
  ),
  s."level"
)
WHERE s."joined_level" IS NULL;
