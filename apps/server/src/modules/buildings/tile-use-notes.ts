import { ItemCountsSchema, type ItemCounts } from '@heartpatch/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../../db/client.js';
import { tileUseNotes } from '../../db/schema.js';

// The one-building-per-tile tidy-up's note (#295), kept apart from the pass
// so the morning report can read it without importing the pass.

/** The tidy-up note's content, as `tile_use_notes` keeps it. */
export interface TileUseNoteContent {
  moved: { buildingId: string; from: { q: number; r: number }; to: { q: number; r: number } }[];
  packed: { buildingId: string; q: number; r: number }[];
  refund: ItemCounts;
  stoppedGatherers: { squishyId: string; name: string }[];
}

const HexAtSchema = z.object({ q: z.number().int(), r: z.number().int() });
const TileUseNoteSchema = z.object({
  moved: z.array(z.object({ buildingId: z.string(), from: HexAtSchema, to: HexAtSchema })),
  packed: z.array(z.object({ buildingId: z.string(), q: z.number().int(), r: z.number().int() })),
  refund: ItemCountsSchema,
  stoppedGatherers: z.array(z.object({ squishyId: z.string(), name: z.string() })),
});

/** The player's tidy-up note, or null. */
export async function readTileUseNote(
  db: Executor,
  owner: { mapId: string; userId: string },
): Promise<(TileUseNoteContent & { notedAt: Date }) | null> {
  const [row] = await db
    .select()
    .from(tileUseNotes)
    .where(and(eq(tileUseNotes.mapId, owner.mapId), eq(tileUseNotes.userId, owner.userId)));
  if (!row) return null;
  // JSON is checked on read, so a hand-edited row fails loudly.
  return { ...TileUseNoteSchema.parse(row), notedAt: row.notedAt };
}
