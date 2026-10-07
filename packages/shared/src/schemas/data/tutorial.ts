import { z } from 'zod';
import { hexKey, hexSpiral, HexSchema } from '../../hex/index.js';
import { GAME_EVENTS, GameEventTypeSchema, type GameEventType } from '../events.js';
import type { GameData } from './game-data.js';
import { BattleAiPolicySchema } from './battle.js';
import { ContentIdSchema, DisplayNameSchema } from './common.js';
import { checkRef, checkUniqueIds, formatDataIssues, type Path, type Report } from './issues.js';

// The single-player tutorial, "The First Patch" (design doc §26; tech spec §7
// "Tutorial maps" and "Tutorial step engine"). Steps are data: adding one
// never needs engine changes (CLAUDE.md rule 5).

/**
 * What the client tutorial layer spotlights during a step (tech spec §6,
 * "Tutorial UI layer"). The client maps each id to a canvas object or DOM
 * element. Ids are a client contract, so never rename one; add new ones.
 */
export const HighlightTargetSchema = z.enum([
  /** Nothing in particular: Sprout just talks. */
  'none',
  /** The glowing spot where the Heart Seed goes. */
  'heart-seed',
  'resource-node',
  'build-button',
  'hearthfire',
  'wild-squishy',
  'battle-moves',
  'capture-button',
  'care-buttons',
  'habitat',
  'neighbor-tile',
  'defense-stance',
  /** The squishy left outside the firelight at nightfall. */
  'outside-squishy',
  'wardrobe-button',
  /** Create a map / enter an invite code, at graduation. */
  'graduation-choices',
]);
export type HighlightTarget = z.infer<typeof HighlightTargetSchema>;

/** A plain JSON value a predicate compares a payload field with. */
const ScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type TutorialScalar = z.infer<typeof ScalarSchema>;

/**
 * Dot path into an event's internal payload (`heartSeed.q`). Checked against
 * the event type's schema by `checkTutorialData`, so a typo fails tests.
 */
const FieldPathSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)*$/);

/**
 * One declarative test on a game event's payload. Data, never code strings:
 * the engine (`tutorial/index.ts`) evaluates them.
 */
export const TutorialPredicateSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('equals'), field: FieldPathSchema, value: ScalarSchema }),
  z.strictObject({
    op: z.literal('oneOf'),
    field: FieldPathSchema,
    values: z.array(ScalarSchema).min(1),
  }),
  z.strictObject({ op: z.literal('atLeast'), field: FieldPathSchema, value: z.number() }),
  /** The field is present and not null. */
  z.strictObject({ op: z.literal('exists'), field: FieldPathSchema }),
]);
export type TutorialPredicate = z.infer<typeof TutorialPredicateSchema>;

/**
 * Event types a step can never complete on: the step engine writes them
 * itself, so a step waiting on one would complete on its own say-so.
 */
export const TUTORIAL_ENGINE_EVENT_TYPES: readonly GameEventType[] = ['tutorial.advanced'];

/** When a step is done: a game event on the tutorial map, plus a predicate. */
export const CompleteOnSchema = z.strictObject({
  eventType: GameEventTypeSchema,
  /**
   * Whose event counts. `player`: the tutorial player did it (gathering,
   * building). `anyone`: system events too (nightfall, the echo's raid).
   */
  actor: z.enum(['player', 'anyone']),
  /** Every predicate must hold. Empty = any event of this type. */
  where: z.array(TutorialPredicateSchema),
});
export type CompleteOn = z.infer<typeof CompleteOnSchema>;

const SPROUT_LINE_MAX = 120; // TUNE: under ~20 words (style guide §2), one bubble on a phone

export const TutorialStepSchema = z.strictObject({
  /** Stored in `users.tutorial_step`, so never rename one. */
  id: ContentIdSchema,
  /** Short goal shown with the step ("Plant your Heart Seed"). */
  goal: DisplayNameSchema,
  /** One or two speech bubbles (design doc §26). */
  sproutLines: z.array(z.string().trim().min(1).max(SPROUT_LINE_MAX)).min(1).max(2),
  highlightTarget: HighlightTargetSchema,
  completeOn: CompleteOnSchema,
});
export type TutorialStep = z.infer<typeof TutorialStepSchema>;

/** One hand-authored tile of the Tutorial Glade (stored as a `tiles` row). */
export const TutorialTileSchema = z.strictObject({
  q: z.number().int(),
  r: z.number().int(),
  terrain: ContentIdSchema,
  nodeResource: ContentIdSchema.nullable(),
  /** Neutral tiles only; null on home tiles. */
  guardianStrength: z.number().int().min(1).nullable(),
  /** The player's home base (slot 0): the Heart Seed and its ring. */
  homeSlot: z.literal(0).nullable(),
});
export type TutorialTile = z.infer<typeof TutorialTileSchema>;

/** The Tutorial Glade (design doc §26): every player gets the same one. */
export const TutorialLayoutSchema = z.strictObject({
  name: DisplayNameSchema,
  /** Hex radius around (0, 0); the tiles cover it exactly. */
  radius: z.number().int().min(1).max(6),
  /** The Heart Seed tile; it and its ring are the home base. */
  heartSeed: HexSchema,
  tiles: z.array(TutorialTileSchema),
});
export type TutorialLayout = z.infer<typeof TutorialLayoutSchema>;

/**
 * `tutorialOverrides` (tech spec §7): what the real gameplay modules do
 * differently on a `kind = 'tutorial'` map. There is no separate tutorial
 * code path: gathering, battles, capture, buildings and nightfall read this
 * through `gameplayOverrides(map.kind)` and apply it. Rules the design doc
 * fixes are literals; tunables are numbers.
 */
export const TutorialOverridesSchema = z.strictObject({
  /** Every gather job takes this long ("seconds, not minutes", design doc §26). */
  gatherSeconds: z.number().int().min(1).max(60),
  /** Building and crafting timers. */
  buildSeconds: z.number().int().min(1).max(60),
  /** A Heart Charm always works (design doc §26 step 5). */
  captureAlwaysSucceeds: z.literal(true),
  /** Wild squishies and guardians: scripted to be winnable. */
  opponent: z.strictObject({
    ai: BattleAiPolicySchema,
    level: z.number().int().min(1),
  }),
  /** The shadowy "echo" that raids the player's tile (step 9). Not a real player. */
  raider: z.strictObject({
    ai: BattleAiPolicySchema,
    level: z.number().int().min(1),
  }),
  /** "Nothing can be lost in the tutorial" (design doc §26). */
  hollowManCanTake: z.literal(false),
});
export type TutorialOverrides = z.infer<typeof TutorialOverridesSchema>;

/**
 * What a new run starts with (#24), besides the Glade itself. The player has
 * no squishy yet, so a Glade friend plays the first battle with them; the
 * wild squishy they befriend there becomes their Partner. A little bag from
 * Sprout covers what the early steps would otherwise make them gather twice.
 */
export const TutorialSetupSchema = z.strictObject({
  /** A public, year-round base form that isn't a starter (the Partner is the starter). */
  helper: z.strictObject({ speciesId: ContentIdSchema, level: z.number().int().min(1).max(10) }),
  /** Items in the run's bag at the start (`tutorial` ledger reason). */
  bag: z.record(ContentIdSchema, z.number().int().min(1)),
});
export type TutorialSetup = z.infer<typeof TutorialSetupSchema>;

export const TutorialDataSchema = z.strictObject({
  steps: z.array(TutorialStepSchema).min(1),
  layout: TutorialLayoutSchema,
  overrides: TutorialOverridesSchema,
  setup: TutorialSetupSchema,
});
export type TutorialData = z.infer<typeof TutorialDataSchema>;

/**
 * The zod schema at `path` inside an object schema, or null if there isn't one.
 * zod's introspection types are loose (`unwrap()` and `shape` aren't typed as
 * plain schemas), hence the casts.
 */
function schemaAt(schema: z.ZodType, path: readonly string[]): z.ZodType | null {
  let node: z.ZodType = schema;
  for (const key of path) {
    while (node instanceof z.ZodOptional || node instanceof z.ZodNullable) {
      node = node.unwrap() as z.ZodType;
    }
    if (!(node instanceof z.ZodObject)) return null;
    const child = (node.shape as Record<string, z.ZodType | undefined>)[key];
    if (child === undefined) return null;
    node = child;
  }
  return node;
}

function checkSteps(steps: readonly TutorialStep[], report: Report): void {
  checkUniqueIds('steps', steps, report);
  steps.forEach((step, i) => {
    const path: Path = ['steps', i];
    const { eventType, where } = step.completeOn;
    if (TUTORIAL_ENGINE_EVENT_TYPES.includes(eventType)) {
      report([...path, 'completeOn', 'eventType'], `steps can't complete on "${eventType}"`);
    }
    // A tap names its step, so a stale double tap on the step before can't
    // complete this one too.
    if (
      eventType === 'tutorial.acknowledged' &&
      !where.some((p) => p.op === 'equals' && p.field === 'stepId' && p.value === step.id)
    ) {
      report(
        [...path, 'completeOn', 'where'],
        `needs { op: "equals", field: "stepId", value: "${step.id}" }`,
      );
    }
    where.forEach((predicate, j) => {
      const field = predicate.field.split('.');
      if (schemaAt(GAME_EVENTS[eventType].internal, field) === null) {
        report(
          [...path, 'completeOn', 'where', j, 'field'],
          `"${eventType}" has no payload field "${predicate.field}"`,
        );
      }
    });
  });
}

function checkLayout(
  layout: TutorialLayout,
  gameData: Pick<GameData, 'terrains' | 'resources' | 'mapGen'>,
  report: Report,
): void {
  const at: Path = ['layout'];
  const expected = new Set(hexSpiral({ q: 0, r: 0 }, layout.radius).map(hexKey));
  const home = new Set(hexSpiral(layout.heartSeed, 1).map(hexKey));
  for (const key of home) {
    if (!expected.has(key)) report([...at, 'heartSeed'], 'the home base must fit inside the Glade');
  }
  const terrains = new Map(gameData.terrains.map((t) => [t.id, t]));
  const resources = new Set(gameData.resources.map((r) => r.id));
  const { mapGen } = gameData;
  const strength = mapGen.guardianStrength;
  const seen = new Set<string>();
  const ringNodes = new Set<string>();

  layout.tiles.forEach((tile, i) => {
    const path: Path = [...at, 'tiles', i];
    const key = hexKey(tile);
    if (seen.has(key)) report(path, `tile (${key}) is listed twice`);
    seen.add(key);
    if (!expected.has(key)) report(path, `tile (${key}) is outside radius ${layout.radius}`);

    const isHome = home.has(key);
    const isHeartSeed = key === hexKey(layout.heartSeed);
    checkRef(new Set(terrains.keys()), 'terrain', tile.terrain, [...path, 'terrain'], report);
    if (isHeartSeed && tile.terrain !== mapGen.homeTerrain) {
      report([...path, 'terrain'], `the Heart Seed sits on "${mapGen.homeTerrain}" (map-gen)`);
    }
    if (isHeartSeed && tile.nodeResource !== null) {
      report([...path, 'nodeResource'], 'the Heart Seed tile has no node');
    }
    if (tile.nodeResource !== null) {
      checkRef(resources, 'resource', tile.nodeResource, [...path, 'nodeResource'], report);
      if (isHome) ringNodes.add(tile.nodeResource);
      const terrain = terrains.get(tile.terrain);
      // Home ring nodes are guaranteed whatever the terrain, as mapgen does (design doc §11).
      if (!isHome && terrain && !terrain.nodeResources.includes(tile.nodeResource)) {
        report(
          [...path, 'nodeResource'],
          `"${tile.terrain}" tiles can't have a "${tile.nodeResource}" node`,
        );
      }
    }

    if (isHome !== (tile.homeSlot === 0)) {
      report([...path, 'homeSlot'], isHome ? 'home tiles need homeSlot 0' : 'not a home tile');
    }
    if (isHome && tile.guardianStrength !== null) {
      report([...path, 'guardianStrength'], 'home tiles have no guardian');
    }
    if (!isHome && tile.guardianStrength === null) {
      report([...path, 'guardianStrength'], 'neutral tiles need a guardian');
    }
    if (
      tile.guardianStrength !== null &&
      (tile.guardianStrength < strength.min || tile.guardianStrength > strength.max)
    ) {
      report(
        [...path, 'guardianStrength'],
        `must be ${strength.min}–${strength.max} (map-gen guardian strength)`,
      );
    }
  });
  for (const key of expected) {
    if (!seen.has(key)) report([...at, 'tiles'], `missing tile (${key})`);
  }
  // Every home ring has these, like on a real map (design doc §11, decision B).
  // Seasonal ones are left out: the Tutorial Glade has no seasons.
  const seasonal = new Set(gameData.resources.filter((r) => r.season).map((r) => r.id));
  for (const resource of mapGen.homeRingNodes) {
    if (!ringNodes.has(resource) && !seasonal.has(resource)) {
      report([...at, 'tiles'], `the home ring needs a "${resource}" node (map-gen homeRingNodes)`);
    }
  }
}

function checkSetup(
  setup: TutorialSetup,
  gameData: Pick<GameData, 'resources' | 'species'>,
  starters: readonly string[],
  report: Report,
): void {
  const at: Path = ['setup'];
  const species = gameData.species.find((s) => s.id === setup.helper.speciesId);
  if (!species) {
    report([...at, 'helper', 'speciesId'], `unknown species "${setup.helper.speciesId}"`);
  } else if (species.season !== undefined || starters.includes(species.id)) {
    report([...at, 'helper', 'speciesId'], 'the helper is a year-round squishy, not a starter');
  }
  const resources = new Set(gameData.resources.map((r) => r.id));
  for (const item of Object.keys(setup.bag)) {
    checkRef(resources, 'resource', item, [...at, 'bag', item], report);
  }
}

/**
 * Validates the tutorial data against the public game data and the event
 * registry, and returns readable problems, or `[]`. Kept separate from
 * `checkGameData` (its own file and table).
 */
export function checkTutorialData(
  input: unknown,
  gameData: Pick<GameData, 'terrains' | 'resources' | 'mapGen' | 'species'>,
  starters: readonly string[] = [],
): string[] {
  const schema = TutorialDataSchema.superRefine((data, ctx) => {
    const report: Report = (path, message) => {
      ctx.addIssue({ code: 'custom', path, message });
    };
    checkSteps(data.steps, report);
    checkLayout(data.layout, gameData, report);
    checkSetup(data.setup, gameData, starters, report);
  });
  const result = schema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}
