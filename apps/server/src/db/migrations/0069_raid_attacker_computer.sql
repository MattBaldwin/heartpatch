ALTER TABLE "raids" ADD COLUMN "attacker_computer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- #386: raids already written by a computer patch-mate. A mate's `users` row
-- is kept when it leaves and `users.kind` never changes, so this is the truth
-- for every older row. Rows the previous release writes during the rollout
-- get the default (false); mates stay off (`HP_COMPUTER_MATES`) until after
-- this ships. Rollback: drop the column.
UPDATE "raids" AS "r" SET "attacker_computer" = true
FROM "users" AS "u"
WHERE "u"."id" = "r"."attacker_user_id" AND "u"."kind" = 'computer';
