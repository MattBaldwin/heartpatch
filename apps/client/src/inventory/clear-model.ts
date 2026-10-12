import {
  CLEARED_TERRAIN,
  CLEARING_RULES,
  GAME_DATA,
  JOB_RULES,
  clearDrop,
  clearToolFor,
  type ClearedTile,
  type Clearing,
  type Gather,
  type ItemCounts,
  type PublicTile,
} from '@heartpatch/shared';
import { landedText } from './bag-view.js';

// Clearing land from the Build sheet (#242): a homestead of mine, on land a
// tool can clear, with nothing standing on it. One use of the tool turns it
// into cleared land a couple of minutes later, and its spot or a little of
// its land's yield drops into the bag. Pure, so every case is unit-tested;
// the server still checks every rule (CLAUDE.md rule 1).

/** The Build sheet's card id for clearing (not a building id). */
export const CLEAR_CARD_ID = 'clear-land';

/** What clearing one tile takes and gives, or why it can't start just now. */
export interface ClearOffer {
  /** The clearing tool it takes one use of. */
  readonly tool: string;
  /** What lands in the bag when it's done. */
  readonly drop: ItemCounts;
  /** Why it can't start right now, or null. */
  readonly blocked: string | null;
  /** The tool isn't in the bag: make one first. */
  readonly needTool: boolean;
}

/** What the clearing side of the tile panel knows (the bag's reply). */
export interface ClearState {
  readonly items: ItemCounts;
  readonly gathers: readonly Gather[];
  readonly clears?: readonly Clearing[];
}

const TOOL_NAMES = new Map<string, string>(CLEARING_RULES.tools.map((t) => [t.id, t.name]));

const article = (name: string) => (/^[aeiou]/i.test(name) ? 'an' : 'a');

// Player-facing text (style guide: cozy, short, kid-readable).
export const CLEAR_TEXT = {
  name: 'Clear land',
  effect: (drop: string) => (drop ? `Makes room to build · drops ${drop}` : 'Makes room to build'),
  needTool: (tool: string) => `Make ${article(tool)} ${tool} in your recipe book first!`,
  gathering: "You're gathering here. Let it finish first!",
  squishyBusy: 'Ask your squishy to move first!',
  already: "You're already clearing land. One at a time!",
  started: 'Clearing! 🌱 It takes a couple of minutes.',
  clearing: (left: string) => `🌱 Clearing… ready in ${left}`,
  clearingDone: '🌱 Clearing… nearly done!',
  firstLine: 'Clear this land first 🌱',
  cleared: 'Land cleared, ready to build! 🌱',
} as const;

/** The tool's name ("Axe"). */
export function toolName(tool: string): string {
  return TOOL_NAMES.get(tool) ?? tool;
}

/**
 * Can this tile be cleared by me? Null when the sheet shouldn't offer it:
 * not mine, home, already cleared, land no tool clears, not a joined
 * homestead, a building on it, or a clear already going here.
 */
export function clearOffer(
  tile: Pick<
    PublicTile,
    | 'q'
    | 'r'
    | 'ownerUserId'
    | 'homeSlot'
    | 'terrain'
    | 'nodeResource'
    | 'homestead'
    | 'buildings'
    | 'clearing'
    | 'workers'
    | 'defenders'
  >,
  me: string | null,
  state: ClearState,
): ClearOffer | null {
  if (me === null || tile.ownerUserId !== me || tile.homeSlot !== null) return null;
  if (tile.terrain === CLEARED_TERRAIN || tile.homestead !== 'joined') return null;
  if (tile.buildings.length > 0 || tile.clearing) return null;
  const tool = clearToolFor(tile.terrain, CLEARING_RULES);
  if (!tool) return null;
  const drop = clearDrop(tile, GAME_DATA.resources, JOB_RULES, CLEARING_RULES);
  const needTool = (state.items[tool] ?? 0) < 1;
  const blocked = state.gathers.some((g) => g.q === tile.q && g.r === tile.r)
    ? CLEAR_TEXT.gathering
    : (tile.workers ?? 0) > 0 || tile.defenders > 0
      ? CLEAR_TEXT.squishyBusy
      : (state.clears ?? []).length > 0
        ? CLEAR_TEXT.already
        : null;
  return { tool, drop, blocked, needTool };
}

/**
 * Does a building wait on this tile being cleared? True on my joined
 * homestead with a resource spot that a tool can clear: the building cards
 * say "Clear this land first" beside the Clear land card.
 */
export function clearsFirst(
  tile: Pick<PublicTile, 'homeSlot' | 'terrain' | 'nodeResource' | 'homestead'>,
): boolean {
  return (
    tile.homeSlot === null &&
    tile.nodeResource !== null &&
    tile.homestead === 'joined' &&
    clearToolFor(tile.terrain, CLEARING_RULES) !== null
  );
}

/**
 * The pop-up when a settle finished clears: "Land cleared, ready to build! 🌱
 * 🌿 +4 Greens!". Land someone else took meanwhile stays as it is, but its
 * drop still lands, so then it's only the drop.
 */
export function clearedText(cleared: readonly ClearedTile[]): string {
  const drop = landedText(cleared);
  if (!cleared.some((c) => c.landCleared)) return drop;
  return drop === '' ? CLEAR_TEXT.cleared : `${CLEAR_TEXT.cleared} ${drop}`;
}
