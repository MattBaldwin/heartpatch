import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { SpeciesSchema } from './data/species.js';
import { OwnedSquishySchema } from './squishies.js';

// Territory API (design doc §11; issue #15; tech spec §5). Players claim
// neutral land from its guardians and challenge each other's land; the raid
// rules are `TERRITORY_RULES`. Guardians are never described here (strength,
// species and seeds stay on the server, CLAUDE.md rule 6).

/**
 * `POST /maps/:mapId/attacks`: battle for this tile (claim it from its
 * guardians, or challenge its owner's defenders). Uses one daily attempt.
 */
export const AttackTileRequestSchema = HexSchema;
export type AttackTileRequest = z.infer<typeof AttackTileRequestSchema>;

/** The squishies standing watch on one of my tiles, by slot. */
export const TileDefendersSchema = z.object({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
  squishyIds: z.array(z.uuid()),
});
export type TileDefenders = z.infer<typeof TileDefendersSchema>;

/**
 * `POST /maps/:mapId/defenders`: who stands watch on one of my tiles (up to
 * `TERRITORY_RULES.maxDefenders`, in slot order). An empty list sends them
 * all home. A squishy already on watch elsewhere moves here.
 */
export const SetDefendersRequestSchema = z.strictObject({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
  squishyIds: z
    .array(z.uuid())
    .max(6)
    .refine((ids) => new Set(ids).size === ids.length, 'A squishy can only stand in one spot.'),
});
export type SetDefendersRequest = z.infer<typeof SetDefendersRequestSchema>;

/** `GET /maps/:mapId/territory`: my raid limits and who stands watch where. */
export const TerritoryStatusSchema = z.object({
  /** Tile battles left today (map-local day). */
  attemptsLeft: z.number().int().min(0),
  attemptsPerDay: z.number().int().min(1),
  /** My land can't be challenged until then (new-player shield); null once it's over. */
  shieldUntil: z.iso.datetime().nullable(),
  /** My tiles with squishies on watch. */
  defenders: z.array(TileDefendersSchema),
  /** My squishies on this map, to pick defenders from. */
  squishies: z.array(OwnedSquishySchema),
  /** Rows the public species table doesn't have, for my own squishies (a secret one I befriended). */
  speciesDefs: z.array(SpeciesSchema),
  /** The server's clock: cooldowns count down against it. */
  now: z.iso.datetime(),
});
export type TerritoryStatus = z.infer<typeof TerritoryStatusSchema>;

export const TerritoryResponseSchema = z.object({ territory: TerritoryStatusSchema });
export type TerritoryResponse = z.infer<typeof TerritoryResponseSchema>;
