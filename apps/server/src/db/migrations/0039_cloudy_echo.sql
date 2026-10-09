ALTER TABLE "maps" DROP CONSTRAINT "maps_max_players_range";--> statement-breakpoint
ALTER TABLE "maps" ALTER COLUMN "max_players" SET DEFAULT 6;--> statement-breakpoint
ALTER TABLE "maps" ADD CONSTRAINT "maps_max_players_range" CHECK ("maps"."max_players" between 1 and 6);