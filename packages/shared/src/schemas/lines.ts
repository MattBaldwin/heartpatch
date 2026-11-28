import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { LineKindSchema, LineLevelSchema } from './data/rails.js';
import { ItemCountsSchema } from './inventory.js';

// Clockwork Isle lines (#874): wires and rails, tile attributes like roads
// (owner answer Q3), laid, raised and taken up by the tile's owner. Land is
// public, so every member sees whose line is where, its kind and level;
// what it cost stays with its owner.

/** `POST /maps/:mapId/lines`, `…/lines/upgrade`, `…/lines/remove`: which of my tiles, and which line. */
export const LineRequestSchema = z.strictObject({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
  kind: LineKindSchema,
});
export type LineRequest = z.infer<typeof LineRequestSchema>;

/** A line on the map: whose, which kind and how good. */
export const PublicLineSchema = z.object({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
  kind: LineKindSchema,
  ownerUserId: z.uuid(),
  level: LineLevelSchema,
  /** Wires only: joined to one of its owner's generators (`POWER_RULES`). Left out on rails. */
  powered: z.boolean().optional(),
});
export type PublicLine = z.infer<typeof PublicLineSchema>;

/** `GET /maps/:mapId/lines`: every line on a Clockwork Isle (`NOT_FOUND` on any other patch). */
export const LinesViewSchema = z.object({ lines: z.array(PublicLineSchema) });
export type LinesView = z.infer<typeof LinesViewSchema>;

/** A line command's answer: the tile's line of that kind now (null once taken up) and my bag. */
export const LineTileResponseSchema = z.object({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
  kind: LineKindSchema,
  line: z.object({ level: LineLevelSchema }).nullable(),
  items: ItemCountsSchema,
  /** A take-up's refund; empty otherwise. */
  refund: ItemCountsSchema,
});
export type LineTileResponse = z.infer<typeof LineTileResponseSchema>;
