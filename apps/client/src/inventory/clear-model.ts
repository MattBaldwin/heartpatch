import { waitingResourceBuilding } from '../resource-buildings/resource-model.js';
import {
  CLEARED_TERRAIN,
  CLEARING_RULES,
  GAME_DATA,
  JOB_RULES,
  clearDrop,
  buildCost,
  clearToolFor,
  type ClearToolId,
  type ClearedTile,
  type Clearing,
  type Gather,
  type ItemCounts,
  type PublicTile,
} from '@heartpatch/shared';
import type { BuildCard } from '../building/build-model.js';
import {
  buildingIcon,
  buildingName,
  effectChips,
  FACTORY,
  GROUNDS,
  LAND_FIRE,
} from '../home/home-view.js';
import { describeItems } from './bag-view.js';
import { CLEAR_TOOL_ICONS } from './item-icons.js';

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
  readonly tool: ClearToolId;
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
  /** My Crafting Factory, if I've built it (one per player, #295). */
  readonly factory?: { readonly buildingId: string } | null;
  /**
   * The seasons on today on this map (the bag's `seasons`, from the server):
   * a seasonal drop out of its season is nothing (#601: Pumpkin Fields after
   * Halloween), as the server's clear decides.
   */
  readonly seasons?: readonly string[];
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
  // Clearing is for homesteads (#242, #295); the server says the same.
  notHomestead:
    'Clear land works on homesteads: land that touches your home 🏡. Explore the land between to join it up!',
  napping: 'This homestead is napping zZ. Join it back up to home first!',
  cleared: 'Land cleared, ready to build! 🌱',
} as const;

/** The tool's name ("Axe"). */
export function toolName(tool: string): string {
  return TOOL_NAMES.get(tool) ?? tool;
}

/**
 * Can this tile be cleared by me? Null when the sheet shouldn't offer it:
 * not mine, home, already cleared, land no tool clears, a building on it,
 * a clear already going here, or land not explored yet. Explored land of
 * mine that isn't a joined homestead gets the card held back with why, so
 * Build never silently leaves it out (#242: an owner on explored land that
 * hadn't joined saw no Clear land).
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
    | 'explored'
    | 'buildings'
    | 'clearing'
    | 'workers'
    | 'defenders'
  >,
  me: string | null,
  state: ClearState,
  now: number,
): ClearOffer | null {
  if (me === null || tile.ownerUserId !== me || tile.homeSlot !== null) return null;
  if (tile.terrain === CLEARED_TERRAIN) return null;
  // Land not explored yet isn't offered: freshly claimed land (the
  // tutorial's first fire too) has enough to do first (#242 review).
  if (tile.homestead !== 'joined' && !tile.explored) return null;
  // Something finished but not banked yet doesn't count: the server banks
  // it first (`settleLeftovers`).
  const going = <T extends { readyAt: string }>(list: readonly T[] = []) =>
    list.filter((x) => Date.parse(x.readyAt) > now);
  const clears = going(state.clears);
  const here = (at: { q: number; r: number }) => at.q === tile.q && at.r === tile.r;
  // Mine shows straight away, before the map hears of it.
  if (tile.buildings.length > 0 || tile.clearing || clears.some(here)) return null;
  const tool = clearToolFor(tile.terrain, CLEARING_RULES);
  if (!tool) return null;
  const drop = clearDrop(
    tile,
    GAME_DATA.resources,
    JOB_RULES,
    CLEARING_RULES,
    state.seasons ? new Set(state.seasons) : undefined,
  );
  const needTool = (state.items[tool] ?? 0) < 1;
  const blocked =
    homesteadReason(tile) ??
    (going(state.gathers).some(here)
      ? CLEAR_TEXT.gathering
      : (tile.workers ?? 0) > 0 || tile.defenders > 0
        ? CLEAR_TEXT.squishyBusy
        : clears.length > 0
          ? CLEAR_TEXT.already
          : null);
  return { tool, drop, blocked, needTool };
}

/** Why my explored land can't be cleared until it's a joined homestead, or null when it is. */
function homesteadReason(tile: Pick<PublicTile, 'homestead'>): string | null {
  if (tile.homestead === 'joined') return null;
  return tile.homestead === 'paused' ? CLEAR_TEXT.napping : CLEAR_TEXT.notHomestead;
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
 * What a settle says about land that finished clearing (#242): "Land cleared,
 * ready to build! 🌱" before its drop's chips, or nothing when someone else
 * took the land meanwhile (its drop still lands).
 */
export function clearedNote(cleared: readonly Pick<ClearedTile, 'landCleared'>[]): string {
  return cleared.some((c) => c.landCleared) ? CLEAR_TEXT.cleared : '';
}

/**
 * The Build sheet's cards for clearing this tile: Clear land, then, on a
 * homestead spot that must be cleared first, the buildings it makes room
 * for, waiting ("Clear this land first"). Those only show while Clear land
 * can start, so a kid who can't clear yet sees why, not a card they can't
 * reach. None when the tile can't be cleared.
 */
export function clearCards(
  tile: Parameters<typeof clearOffer>[0],
  me: string | null,
  state: ClearState,
  now: number,
): BuildCard[] {
  const offer = clearOffer(tile, me, state, now);
  if (!offer) return [];
  const clear: BuildCard = {
    id: CLEAR_CARD_ID,
    icon: CLEAR_TOOL_ICONS[offer.tool],
    name: CLEAR_TEXT.name,
    effect: CLEAR_TEXT.effect(describeItems(offer.drop)),
    cost: { [offer.tool]: 1 },
    area: 'spot',
    blocked: offer.blocked,
    craft: offer.needTool ? CLEAR_TEXT.needTool(toolName(offer.tool)) : null,
  };
  // On land with no spot, Clear land comes after the buildings that can go
  // up as it is (the home source's cards come first).
  if (offer.blocked || !clearsFirst(tile)) return [clear];
  // My one Crafting Factory waits here too until I've built it (#295).
  const factory = state.factory ? undefined : FACTORY;
  // And the resource building its land takes (#601 PR 7).
  const producing = waitingResourceBuilding(tile);
  const waiting = [LAND_FIRE, GROUNDS, factory, producing].flatMap((b) =>
    b
      ? [
          {
            id: b.id,
            icon: buildingIcon(b.id),
            name: buildingName(b.id),
            effect: effectChips(b)[0] ?? b.description,
            cost: buildCost(b),
            area: 'spot' as const,
            blocked: CLEAR_TEXT.firstLine,
            craft: null,
          },
        ]
      : [],
  );
  return [clear, ...waiting];
}
