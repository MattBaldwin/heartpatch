ALTER TABLE "map_members" ADD COLUMN "home_name" text;--> statement-breakpoint
ALTER TABLE "map_members" ADD COLUMN "home_named_at_level" smallint;--> statement-breakpoint
ALTER TABLE "map_members" ADD COLUMN "caught_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "map_members" ADD COLUMN "kinds_built" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- #306: the home-naming event consumer starts at each patch's head, and the
-- back-fill below counts only events up to that position, so no event is
-- counted twice or missed (an event that commits in between is the
-- consumer's). Patches made later start from seq 0 as usual. Rollback: drop
-- the four columns and DELETE FROM "event_consumers" WHERE "consumer" = 'home-naming'.
INSERT INTO "event_consumers" ("consumer", "map_id", "last_seq")
SELECT 'home-naming', "id", "event_seq" FROM "maps" WHERE "kind" = 'multiplayer'
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- #306: squishies befriended in battle on each patch so far.
UPDATE "map_members" AS "m" SET "caught_count" = "c"."n"
FROM (
  SELECT "e"."map_id", "e"."payload"->>'userId' AS "user_id", count(*)::integer AS "n"
  FROM "game_events" AS "e"
  JOIN "event_consumers" AS "p" ON "p"."consumer" = 'home-naming' AND "p"."map_id" = "e"."map_id"
  WHERE "e"."type" = 'squishy.captured' AND "e"."seq" <= "p"."last_seq"
  GROUP BY 1, 2
) AS "c"
WHERE "m"."map_id" = "c"."map_id" AND "m"."user_id"::text = "c"."user_id";--> statement-breakpoint
-- #306: buildable kinds built on each patch so far: placed and fence events
-- up to the consumer's start, plus what stands now (older events may be gone
-- to retention). The CASE is today's building ids by kind
-- (packages/shared/src/data/buildings.ts; migration-home-names.test.ts checks it).
UPDATE "map_members" AS "m" SET "kinds_built" = "k"."kinds"
FROM (
  SELECT "map_id", "user_id", array_agg(DISTINCT "kind" ORDER BY "kind") AS "kinds"
  FROM (
    SELECT "e"."map_id", "e"."payload"->>'userId' AS "user_id",
      CASE "e"."payload"->'building'->>'buildingId'
        WHEN 'hearthfire' THEN 'hearthfire'
        WHEN 'jack-o-lantern-hearthfire' THEN 'hearthfire'
        WHEN 'ember-den' THEN 'habitat'
        WHEN 'cozy-meadow' THEN 'habitat'
        WHEN 'training-grounds' THEN 'training-grounds'
        WHEN 'crafting-factory' THEN 'factory'
        WHEN 'hedge' THEN 'fence'
        WHEN 'moat' THEN 'fence'
        WHEN 'stone-wall' THEN 'fence'
        WHEN 'emberwood-palisade' THEN 'fence'
        WHEN 'glimmer-rail' THEN 'fence'
        WHEN 'lantern-fence' THEN 'fence'
        WHEN 'bramble-hedge' THEN 'fence'
        WHEN 'ice-wall' THEN 'fence'
      END AS "kind"
    FROM "game_events" AS "e"
    JOIN "event_consumers" AS "p" ON "p"."consumer" = 'home-naming' AND "p"."map_id" = "e"."map_id"
    WHERE "e"."type" = 'building.placed' AND "e"."seq" <= "p"."last_seq"
    UNION ALL
    SELECT "e"."map_id", "e"."payload"->>'userId', 'fence'
    FROM "game_events" AS "e"
    JOIN "event_consumers" AS "p" ON "p"."consumer" = 'home-naming' AND "p"."map_id" = "e"."map_id"
    WHERE "e"."type" = 'fence.built' AND "e"."seq" <= "p"."last_seq"
    UNION ALL
    SELECT "b"."map_id", "b"."owner_user_id"::text, "b"."kind"
    FROM "buildings" AS "b"
    JOIN "maps" AS "mp" ON "mp"."id" = "b"."map_id" AND "mp"."kind" = 'multiplayer'
    WHERE "b"."kind" IN ('hearthfire', 'habitat', 'training-grounds', 'factory', 'fence')
    UNION ALL
    SELECT "f"."map_id", "f"."owner_user_id"::text, 'fence'
    FROM "fence_segments" AS "f"
    JOIN "maps" AS "mp" ON "mp"."id" = "f"."map_id" AND "mp"."kind" = 'multiplayer'
  ) AS "built"
  WHERE "kind" IS NOT NULL
  GROUP BY 1, 2
) AS "k"
WHERE "m"."map_id" = "k"."map_id" AND "m"."user_id"::text = "k"."user_id";
