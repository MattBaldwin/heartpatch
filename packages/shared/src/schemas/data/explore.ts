import { z } from 'zod';
import { ContentIdSchema, DisplayNameSchema } from './common.js';
import type { GameData } from './game-data.js';
import { formatDataIssues } from './issues.js';

/**
 * Most search spots one tile can have. A player's progress on a tile is a
 * bitmask in a Postgres `integer` (`tile_explore.searched`), so it stays
 * clear of the sign bit.
 */
export const MAX_SEARCH_SPOTS = 30;

/** The four crafted tools (#199). A spot with no tool is searched by hand. */
export const ToolIdSchema = z.enum(['shovel', 'net', 'rope', 'lantern']);
export type ToolId = z.infer<typeof ToolIdSchema>;

/** The touch mini-interaction a spot plays (feel only: the server rolls every find). */
export const SpotInteractionSchema = z.enum([
  'lift',
  'shake',
  'dig',
  'scoop',
  'climb',
  'light',
  // #335: on the mountain trail, poke a snow drift and stack a cairn; in the
  // hills cave, boop the glow mushrooms.
  'poke',
  'stack',
  'pick',
]);
export type SpotInteraction = z.infer<typeof SpotInteractionSchema>;

/** A kind of search spot: a rock to lift, a mound to dig, a cave to light. */
export const SearchSpotKindSchema = z.strictObject({
  id: ContentIdSchema,
  /** Player-facing ("Mounds to dig" on the explore list). */
  name: DisplayNameSchema,
  tool: ToolIdSchema.nullable(),
  interaction: SpotInteractionSchema,
});
export type SearchSpotKind = z.infer<typeof SearchSpotKindSchema>;

/** A crafted tool and how many searches it lasts (owner decision 2026-10-06: tools wear out). */
export const ExploreToolSchema = z.strictObject({
  id: ToolIdSchema,
  name: DisplayNameSchema,
  uses: z.number().int().min(1).max(200),
});
export type ExploreTool = z.infer<typeof ExploreToolSchema>;

/** One explorable terrain: its prop kit and how many spots a tile gets. */
export const ExploreTerrainSchema = z
  .strictObject({
    terrain: ContentIdSchema,
    /**
     * This terrain's own layout version (#335), when it differs from the
     * rules' `layout`. Bump it when this terrain's kit or spot count changes,
     * so only this terrain's saved progress is read as stale.
     */
    layout: z.number().int().min(1).optional(),
    kinds: z
      .array(z.strictObject({ kind: ContentIdSchema, weight: z.number().int().positive() }))
      .min(1),
    spots: z.strictObject({
      min: z.number().int().min(1).max(MAX_SEARCH_SPOTS),
      max: z.number().int().min(1).max(MAX_SEARCH_SPOTS),
    }),
  })
  .refine((t) => t.spots.min <= t.spots.max, {
    message: 'spots.min must not be more than spots.max',
    path: ['spots', 'min'],
  });
export type ExploreTerrain = z.infer<typeof ExploreTerrainSchema>;

/** The explore sky's time of day (#335): dawn and dusk are the warm ones. */
export const SkyPhaseSchema = z.enum(['dawn', 'day', 'dusk', 'night']);
export type SkyPhase = z.infer<typeof SkyPhaseSchema>;

/**
 * When each sky starts, in minutes after the patch's local midnight, in
 * order. The first starts at 0; the day's last one runs on past midnight
 * until the first change of the next day.
 */
export const ExploreSkySchema = z
  .strictObject({
    phases: z
      .array(
        z.strictObject({
          from: z
            .number()
            .int()
            .min(0)
            .max(24 * 60 - 1),
          phase: SkyPhaseSchema,
        }),
      )
      .min(1),
    /** Each change fades in over this many minutes, ending at the next phase's `from`. */
    blendMinutes: z.number().int().min(0).max(120),
  })
  .refine((s) => s.phases[0]?.from === 0, {
    message: 'the first phase starts at 0',
    path: ['phases', 0, 'from'],
  })
  .refine((s) => s.phases.every((p, i) => i === 0 || p.from > (s.phases[i - 1]?.from ?? 0)), {
    message: 'phases must be in time order',
    path: ['phases'],
  })
  .refine(
    (s) =>
      s.phases.every((p, i) => {
        const next = s.phases[i + 1]?.from ?? 24 * 60 + (s.phases[0]?.from ?? 0);
        return next - p.from >= s.blendMinutes;
      }),
    { message: 'every phase lasts at least blendMinutes', path: ['blendMinutes'] },
  );
export type ExploreSky = z.infer<typeof ExploreSkySchema>;

/**
 * Exploring your land (#199). Public: the explore view, the tile panel's
 * "12 secret spots to search" and the server all read it. What a spot
 * *gives* is server-only (`data/server/explore-finds.ts`, CLAUDE.md rule 6).
 */
export const ExploreRulesSchema = z.strictObject({
  /**
   * The search-spot generator's version. Spots are a pure function of the
   * map seed, the tile, its terrain and this number; bump it whenever a
   * change here or in the generator would move or swap a tile's spots, so
   * saved progress (stored with the version it was made under) is never
   * read against a different layout.
   */
  layout: z.number().int().min(1),
  spotKinds: z.array(SearchSpotKindSchema).min(1),
  tools: z.array(ExploreToolSchema),
  /** Terrains you can explore. One missing here (Juniper's Gap) can't be explored. */
  terrains: z.array(ExploreTerrainSchema).min(1),
  /**
   * Where spots go inside a tile, in tile-local units (the tile's corner is
   * 1 from its middle, laid out like `hexToWorld` at size 1).
   */
  placement: z.strictObject({
    /** Building spots' sub-hex size; matches the client's `SPOT_SIZE`. */
    buildingSpotScale: z.number().positive().max(0.5),
    /** Search spots keep this far from every building spot (all 7, used or not). */
    buildingClearance: z.number().positive().max(0.5),
    /** And this far from each other. */
    minGap: z.number().positive().max(0.5),
    /** And this far inside the tile's edge. */
    edgeMargin: z.number().min(0).max(0.5),
  }),
  /** The sky over the explore view, by the patch's local time (#335). */
  sky: ExploreSkySchema,
  /** XP each squishy on the team gets per search: plain XP, like Training Grounds. */
  xpPerSquishy: z.number().int().min(0).max(1000),
  /**
   * A joined homestead's bigger yield (owner decisions 2026-10-07: Q1, then
   * yield, not speed). Each finished cycle on it, a squishy's or the
   * Keeper's, gives `ceil(quantity × yieldPercent / 100) + yieldPlus`
   * (`homesteadQuantity`). A paused homestead gives nothing.
   */
  homestead: z.strictObject({
    yieldPercent: z.number().int().min(100).max(400),
    yieldPlus: z.number().int().min(0).max(10),
  }),
});
export type ExploreRules = z.infer<typeof ExploreRulesSchema>;

/**
 * Validates the explore rules against the content they name (real terrains,
 * known spot kinds, a tool row for every tool a spot needs) and returns
 * readable problems, or `[]`.
 */
export function checkExploreRules(
  input: unknown,
  data: Pick<GameData, 'terrains' | 'resources' | 'recipes'>,
): string[] {
  const result = ExploreRulesSchema.safeParse(input);
  if (!result.success) return formatDataIssues(input, result.error);
  const rules = result.data;
  const problems: string[] = [];
  const terrains = new Set(data.terrains.map((t) => t.id));

  const kinds = new Map<string, SearchSpotKind>();
  rules.spotKinds.forEach((k, i) => {
    if (kinds.has(k.id)) problems.push(`spotKinds[${String(i)}]: duplicate id "${k.id}"`);
    kinds.set(k.id, k);
  });
  const tools = new Set<string>();
  rules.tools.forEach((t, i) => {
    if (tools.has(t.id)) problems.push(`tools[${String(i)}]: duplicate tool "${t.id}"`);
    tools.add(t.id);
    // The bag holds a tool as an item counted in uses (`Resource.tool`).
    if (!data.resources.some((r) => r.tool === t.id)) {
      problems.push(`tools[${String(i)}]: no item with tool "${t.id}"`);
    }
    // A recipe makes one whole tool: exactly its uses.
    for (const recipe of data.recipes) {
      if (recipe.output.resource === t.id && recipe.output.quantity !== t.uses) {
        problems.push(
          `tools[${String(i)}]: recipe "${recipe.id}" makes ${String(recipe.output.quantity)} uses, not ${String(t.uses)}`,
        );
      }
    }
  });

  const used = new Set<string>();
  const seenTerrains = new Set<string>();
  rules.terrains.forEach((t, i) => {
    const at = `terrains[${String(i)}]`;
    if (!terrains.has(t.terrain)) problems.push(`${at}: unknown terrain "${t.terrain}"`);
    if (seenTerrains.has(t.terrain)) problems.push(`${at}: ${t.terrain} is listed twice`);
    seenTerrains.add(t.terrain);
    const groups = new Set<string | null>();
    const seenKinds = new Set<string>();
    t.kinds.forEach((k, j) => {
      const kind = kinds.get(k.kind);
      if (!kind) {
        problems.push(`${at}.kinds[${String(j)}]: unknown spot kind "${k.kind}"`);
        return;
      }
      if (seenKinds.has(k.kind)) problems.push(`${at}.kinds[${String(j)}]: ${k.kind} twice`);
      seenKinds.add(k.kind);
      used.add(k.kind);
      groups.add(kind.tool);
      if (kind.tool !== null && !tools.has(kind.tool)) {
        problems.push(`${at}.kinds[${String(j)}]: no tools row for "${kind.tool}"`);
      }
    });
    // The generator puts one spot of each tool group on every tile, so a
    // tile always needs every tool its terrain lists.
    if (t.spots.min < groups.size) {
      problems.push(`${at}: spots.min is less than its ${String(groups.size)} tool groups`);
    }
  });
  for (const id of kinds.keys()) {
    if (!used.has(id)) problems.push(`spot kind "${id}" is on no terrain`);
  }
  return problems;
}
