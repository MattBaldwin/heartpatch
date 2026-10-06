import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { SpeciesSchema } from './data/species.js';
import { OwnedSquishySchema } from './squishies.js';
import { LocalDateSchema } from './time.js';

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

/**
 * One of my tiles that misses me (owner decision 2026-10-06, design review
 * Q2): untended for a while, so it's fading. `fade` is 0 (just started) to
 * 100 (it can go wild at the next nightfall). Only the owner sees these.
 */
export const MissingTileSchema = z.object({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
  fade: z.number().int().min(0).max(100),
  /** It can go wild at the first nightfall from then. */
  wildFrom: z.iso.datetime(),
});
export type MissingTile = z.infer<typeof MissingTileSchema>;

/** A tile of mine that went wild again lately (and isn't mine again yet). */
export const WentWildTileSchema = z.object({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
  /** The map-local night it went wild. */
  night: LocalDateSchema,
});
export type WentWildTile = z.infer<typeof WentWildTileSchema>;

/**
 * `GET /maps/:mapId/territory/tending` and `POST /maps/:mapId/territory/visit`
 * (Visit tends all my land at once): my land that misses me and what went
 * wild lately.
 */
export const LandTendingSchema = z.object({
  missing: z.array(MissingTileSchema),
  /** Tiles that went wild from me in the last few nights. */
  wentWild: z.array(WentWildTileSchema),
  /** When some land will next start to miss me (the client looks again then); null with no land that can fade. */
  nextMissesYouAt: z.iso.datetime().nullable(),
  /** The server's clock. */
  now: z.iso.datetime(),
});
export type LandTending = z.infer<typeof LandTendingSchema>;

/**
 * Dev only (`HP_DEV_SQUISHY_GRANTS`): `POST /maps/:mapId/dev/territory/age`
 * moves my land's last tending this many days back, then lets tonight's land
 * go wild, so fading can be tried on a device.
 */
export const DevAgeLandRequestSchema = z.strictObject({ days: z.number().int().min(1).max(60) });
export type DevAgeLandRequest = z.infer<typeof DevAgeLandRequestSchema>;

export const LandTendingResponseSchema = z.object({ tending: LandTendingSchema });
export type LandTendingResponse = z.infer<typeof LandTendingResponseSchema>;
