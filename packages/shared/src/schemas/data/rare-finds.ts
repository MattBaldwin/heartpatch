import { z } from 'zod';
import { RaritySchema, type Rarity } from './common.js';

/*
 * Rare finds (#391, owner decisions 2026-10-12): the moment a rare-or-better
 * wild squishy shows up, by tier. A tier is data, not a code branch, so a new
 * one (Mythic arrives in Phase 2) is one new row.
 */

export const RareFindTierSchema = z.strictObject({
  /** The whole moment the first time a player meets the kind on a patch (ms). */
  ms: z.number().int().min(500).max(5000),
  /**
   * How big the beat is, rare's being 1: the client scales its sparkles, dim,
   * banner and chime from this (`RARE_REVEAL` in the client's battle config).
   */
  scale: z.number().int().min(1).max(6),
  /** The tier's word on the banner's card chip ("Rare", "Special"). */
  label: z.string().trim().min(1).max(16),
  /** The banner's words (style guide §2: short, cozy). */
  banner: z.string().trim().min(1).max(48),
  /** Befriending one tells the whole patch (the patch line). */
  patchLine: z.boolean(),
});
export type RareFindTier = z.infer<typeof RareFindTierSchema>;

/** Tiers by rarity; a rarity with no row has no moment of its own (`rareFindTier`). */
export const RareFindTiersSchema = z.partialRecord(RaritySchema, RareFindTierSchema);
export type RareFindTiers = Partial<Record<Rarity, RareFindTier>>;
