import {
  HOME_BASE_RULES,
  roadCost,
  roadRefund,
  roadSpeedPercent,
  topRoadLevel,
  TRAVEL_RULES,
  type ItemCounts,
  type PublicTile,
  type TravelRules,
} from '@heartpatch/shared';
import type { BuildCard } from '../building/build-model.js';
import { costShort } from '../building/build-model.js';
import { isWaterTile } from '../map/map-dressing.js';

// What the Build sheet and the tile panel say about roads (#621 W1-6): a
// Path, then a Road, then a Paved road, each laid on the one before, and taken
// up for half back. Pure, so every case is unit-tested; the server still
// checks every cost and rule (CLAUDE.md rule 1).

/** The Build sheet's card ids: the level the card takes the road to. */
export const ROAD_CARD_PREFIX = 'road-';

export const ROAD_NAMES = ['Path', 'Road', 'Paved road'] as const;

/** Player-facing text (style guide: cozy, short, kid-readable). */
export const ROAD_TEXT = {
  icon: '🧱',
  /** The server's FORBIDDEN, said before the tap. */
  cutOff: 'This land is cut off from home! Join it up with a road or a bridge first. 🪵',
  built: (level: number) =>
    level <= 1 ? 'Ta-da! A cozy path!' : `Ta-da! Now it's a ${roadName(level).toLowerCase()}!`,
  line: (level: number) =>
    `${ROAD_TEXT.icon} A ${roadName(level).toLowerCase()} runs through here.`,
  takeUp: 'Take up road',
  takeUpAsk: (back: string) =>
    back ? `Take up this road? You get back ${back}.` : 'Take up this road?',
  yes: 'Yes, take it up',
  keep: 'Keep it',
  tookUp: (back: string) => (back ? `Road taken up. You got back ${back}.` : 'Road taken up.'),
  working: 'One moment…',
  /** The Build sheet's top line for each level's card. */
  hints: [
    'A path goes right in the middle. 🧱',
    'Make the path a wider road!',
    'Pave the road with stone!',
  ],
} as const;

export function roadName(level: number): string {
  return ROAD_NAMES[Math.max(0, Math.min(level, ROAD_NAMES.length) - 1)] ?? 'Road';
}

/** The level a road card takes a tile's road to, or null for another card. */
export function roadCardLevel(cardId: string): number | null {
  if (!cardId.startsWith(ROAD_CARD_PREFIX)) return null;
  const n = Number(cardId.slice(ROAD_CARD_PREFIX.length));
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** Which command a road card sends: laying the first level, or raising the road. */
export function roadCommandFor(level: number): 'build' | 'upgrade' {
  return level <= 1 ? 'build' : 'upgrade';
}

/** One line on what a level does: how far it joins up, and the pace. */
export function roadEffect(
  level: number,
  rules: Pick<TravelRules, 'roads'> = TRAVEL_RULES,
): string {
  const reach = rules.roads.levels[level - 1]?.reach ?? 0;
  const speed = roadSpeedPercent(level, rules);
  const tiles = `Joins land ${String(reach)} ${reach === 1 ? 'tile' : 'tiles'} away.`;
  return speed !== null && speed > 100 ? `${tiles} Squishies hurry!` : tiles;
}

export interface RoadCardInput {
  readonly tile: PublicTile;
  readonly me: string | null;
  /** My road's level on this tile, or null with none. */
  readonly level: number | null;
  /**
   * Is the tile joined to home (`supplyMap`)? Null while roads or tiles
   * haven't loaded: the server then decides.
   */
  readonly supplied: boolean | null;
  readonly rules?: Pick<TravelRules, 'roads'>;
}

/**
 * The one card a tile of mine offers: a Path where there's no road, else the
 * next level up (none at the top). A Path on land that's cut off from home
 * is a blocked card that says why, so it is never just missing.
 */
export function roadCards(input: RoadCardInput): BuildCard[] {
  const { tile, me, level, supplied } = input;
  const rules = input.rules ?? TRAVEL_RULES;
  if (!me || tile.ownerUserId !== me || isWaterTile(tile)) return [];
  const next = (level ?? 0) + 1;
  if (next > topRoadLevel(rules)) return [];
  const cost = roadCost(next, rules);
  if (!cost) return [];
  return [
    {
      id: `${ROAD_CARD_PREFIX}${String(next)}`,
      icon: ROAD_TEXT.icon,
      name: roadName(next),
      effect: roadEffect(next, rules),
      cost,
      area: 'spot',
      blocked: level === null && supplied === false ? ROAD_TEXT.cutOff : null,
      craft: null,
      hint: ROAD_TEXT.hints[Math.min(next, ROAD_TEXT.hints.length) - 1] ?? ROAD_TEXT.hints[0],
    },
  ];
}

/** What a road of `level` gives back when it's taken up. */
export function takeUpRefund(level: number): ItemCounts {
  return roadRefund(level, TRAVEL_RULES, HOME_BASE_RULES);
}

/** "2 🪵 3 🪨", or '' when nothing comes back. */
export function refundText(refund: ItemCounts): string {
  return Object.keys(refund).length === 0 ? '' : costShort(refund);
}
