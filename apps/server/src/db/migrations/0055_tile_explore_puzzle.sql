ALTER TABLE "tile_explore" ADD COLUMN "puzzle_attempt" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tile_explore" ADD COLUMN "puzzle_solved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tile_explore" ADD COLUMN "fragment_found_at" timestamp with time zone;