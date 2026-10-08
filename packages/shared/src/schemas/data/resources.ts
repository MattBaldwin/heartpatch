import { z } from 'zod';
import { ContentIdSchema, DescriptionSchema, DisplayNameSchema } from './common.js';
import { ToolIdSchema } from './explore.js';

/**
 * Inventory things (design doc §12): gathered from nodes, seasonal (only
 * gathered in their season, kept as keepsakes after), or crafted by recipes.
 */
export const ResourceKindSchema = z.enum(['gathered', 'seasonal', 'crafted']);
export type ResourceKind = z.infer<typeof ResourceKindSchema>;

/**
 * How a resource node gathers (design doc §12): one gather takes `seconds`
 * and yields `quantity`. `extras` are bonus finds that come with it; an extra
 * that is a seasonal resource only turns up while its season is on.
 */
export const GatherSettingsSchema = z.strictObject({
  seconds: z.number().int().positive(),
  quantity: z.number().int().positive(),
  extras: z
    .array(z.strictObject({ resource: ContentIdSchema, quantity: z.number().int().positive() }))
    .optional(),
});
export type GatherSettings = z.infer<typeof GatherSettingsSchema>;

const percent = z.number().int().min(1).max(100);

/**
 * What a battle item does when a squishy uses it in battle (#214). It takes
 * the squishy's turn. `attackPercent`/`defensePercent` raise that stat for
 * the rest of the battle; `healPercent` gives back that share of full
 * energy; `shieldPercent` takes that share off the next hit it takes (the
 * shield doesn't stack: a new one replaces the old).
 */
export const BattleItemEffectSchema = z
  .strictObject({
    attackPercent: percent.optional(),
    defensePercent: percent.optional(),
    healPercent: percent.optional(),
    shieldPercent: percent,
  })
  .refine((e) => e.attackPercent ?? e.defensePercent ?? e.healPercent, {
    message: 'a battle item needs a boost or a heal besides its shield',
  });
export type BattleItemEffect = z.infer<typeof BattleItemEffectSchema>;

export const ResourceSchema = z.strictObject({
  id: ContentIdSchema,
  name: DisplayNameSchema,
  description: DescriptionSchema,
  kind: ResourceKindSchema,
  /** Required for seasonal resources, not allowed otherwise. */
  season: ContentIdSchema.optional(),
  /**
   * Gathering from a node of this resource. Every resource a map can put on
   * a node (terrains, home rings) needs one; `checkGameData` checks it.
   */
  gather: GatherSettingsSchema.optional(),
  /** Usable in battle (potions, #214). Only crafted items have one; `checkGameData` checks it. */
  battleEffect: BattleItemEffectSchema.optional(),
  /**
   * An explore tool (#199): the bag counts it in uses, so one Shovel is
   * `EXPLORE_RULES` tool uses of `shovel`, and each search that needs it
   * spends one. Only crafted items, and the id must be the tool's.
   */
  tool: ToolIdSchema.optional(),
  /**
   * Can it be traded or gifted at a trading post (#271)? Missing means yes.
   * Explore tools are worn in uses, so they stay with their Keeper
   * (`checkGameData` refuses a tradable tool).
   */
  tradable: z.boolean().optional(),
});
export type Resource = z.infer<typeof ResourceSchema>;

/** Can this item be traded or gifted (#271)? Everything is, unless its data says not. */
export function isTradableResource(resource: Pick<Resource, 'tradable'>): boolean {
  return resource.tradable !== false;
}
