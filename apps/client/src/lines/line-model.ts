import {
  HOME_BASE_RULES,
  POWER_RULES,
  RAIL_RULES,
  type ItemCounts,
  type LineKind,
  type PowerRules,
  type PublicTile,
  type RailRules,
} from '@heartpatch/shared';
import type { BuildCard } from '../building/build-model.js';
import { costShort } from '../building/build-model.js';
import { isWaterTile } from '../map/map-dressing.js';

// What the Build sheet and the tile panel say about a Clockwork Isle's
// wires and rails (#874 C4, mockup M2): a Wire carries Spark from a
// Windmill to a machine; a Rail (then a Brass rail) carries goodies home.
// Both are laid on my land and taken up for half back. Pure, so every case
// is unit-tested; the server checks every cost, reach and rule (CLAUDE.md
// rule 1) and works out which wires carry power.

/** The Build sheet's card ids: `line-wire`, `line-rail-1`, `line-rail-2`. */
export const LINE_CARD_PREFIX = 'line-';

/** Player-facing text (style guide and plan §7: cozy, short, kid-readable). */
export const LINE_TEXT = {
  wireIcon: '⚡',
  railIcon: '🛤️',
  wireName: 'Wire',
  railNames: ['Rail', 'Brass rail'],
  /** The cards' one-line effects (mockup M2). */
  wireEffect: (maxRun: number) => `Carries Spark. Up to ${String(maxRun)} tiles.`,
  railEffects: ['Carts carry goodies home.', 'Shinier! Carts roll faster.'],
  /** The sheet's top line while a card is picked. */
  wireHint: 'A wire hops from post to post. ⚡',
  railHints: ['Lay a rail, then join it up! 🛤️', 'Polish the rail into brass!'],
  /** A rail level that waits on a blueprint (the server says no until then). */
  needsResearch: 'Needs the Tidy Rails blueprint first.',
  /** The server's FORBIDDEN for land that's cut off, said before the tap (plan §7). */
  cutOff: "Lay wires from land that's joined up to home!",
  railCutOff: "Lay rails from land that's joined up to home!",
  wireBuilt: 'Zap! A wire is up. ⚡',
  railBuilt: (level: number) =>
    level <= 1 ? 'Clickety-clack! A rail is down. 🛤️' : 'Shiny! Now it’s a brass rail.',
  /** The tile panel's lines. */
  wireLit: '⚡ A wire hums here. It carries Spark!',
  wireDark: '⚡ A quiet wire. Join it to a Windmill!',
  railLine: (level: number) => `🛤️ A ${railName(level).toLowerCase()} runs through here.`,
  takeUpWire: 'Take up wire',
  takeUpRail: 'Take up rail',
  takeUpAsk: (what: string, back: string) =>
    back ? `Take up this ${what}? You get back ${back}.` : `Take up this ${what}?`,
  yes: 'Yes, take it up',
  keep: 'Keep it',
  tookUp: (what: string, back: string) =>
    back ? `${capital(what)} taken up. You got back ${back}.` : `${capital(what)} taken up.`,
} as const;

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function railName(level: number): string {
  const names = LINE_TEXT.railNames;
  return names[Math.max(0, Math.min(level, names.length) - 1)] ?? 'Rail';
}

/** A card's id: the kind and the level it takes the tile's line to. */
export function lineCardId(kind: LineKind, level: number): string {
  return kind === 'wire' ? `${LINE_CARD_PREFIX}wire` : `${LINE_CARD_PREFIX}rail-${String(level)}`;
}

/** Which line a card lays or raises, or null for another source's card. */
export function lineCardOf(cardId: string): { kind: LineKind; level: number } | null {
  if (cardId === `${LINE_CARD_PREFIX}wire`) return { kind: 'wire', level: 1 };
  const prefix = `${LINE_CARD_PREFIX}rail-`;
  if (!cardId.startsWith(prefix)) return null;
  const level = Number(cardId.slice(prefix.length));
  return Number.isInteger(level) && level >= 1 ? { kind: 'rail', level } : null;
}

/** Which command a card sends: laying a line, or raising a rail. */
export function lineCommandFor(level: number): 'build' | 'upgrade' {
  return level <= 1 ? 'build' : 'upgrade';
}

/** One line on what a rail level does: how far it joins up, and the pace (mockup M2). */
export function railEffect(level: number, rules: RailRules = RAIL_RULES): string {
  const row = rules.levels[level - 1];
  const words = LINE_TEXT.railEffects[Math.min(level, LINE_TEXT.railEffects.length) - 1] ?? '';
  if (!row) return words;
  const tiles = `Joins land ${String(row.reach)} ${row.reach === 1 ? 'tile' : 'tiles'} away.`;
  return `${words} ${tiles}`;
}

export interface LineCardInput {
  readonly tile: PublicTile;
  readonly me: string | null;
  /** My wire on this tile? */
  readonly wire: boolean;
  /** My rail's level on this tile, or null with none. */
  readonly rail: number | null;
  /**
   * Is the tile joined to home (the supply line, rails in)? Null while the
   * lines or roads haven't loaded: the server then decides.
   */
  readonly supplied: boolean | null;
  readonly power?: PowerRules;
  readonly rails?: RailRules;
}

/**
 * The cards a tile of mine offers: a Wire where I have none, and a Rail
 * where I have none (else the next rail level, none at the top). A new line
 * on land that's cut off from home is a blocked card that says why, so it
 * is never just missing. A level that waits on a blueprint shows it in its
 * hint; the server refuses it until its owner knows the research.
 */
export function lineCards(input: LineCardInput): BuildCard[] {
  const { tile, me, wire, rail, supplied } = input;
  const power = input.power ?? POWER_RULES;
  const rails = input.rails ?? RAIL_RULES;
  if (!me || tile.ownerUserId !== me || isWaterTile(tile)) return [];
  const cutOff = supplied === false;
  const cards: BuildCard[] = [];
  if (!wire && power.model === 'wires') {
    cards.push({
      id: lineCardId('wire', 1),
      icon: LINE_TEXT.wireIcon,
      name: LINE_TEXT.wireName,
      effect: LINE_TEXT.wireEffect(power.wire.maxRun),
      cost: power.wire.cost,
      area: 'spot',
      blocked: cutOff ? LINE_TEXT.cutOff : null,
      craft: null,
      hint: LINE_TEXT.wireHint,
    });
  }
  const next = (rail ?? 0) + 1;
  const row = rails.levels[next - 1];
  if (row) {
    cards.push({
      id: lineCardId('rail', next),
      icon: LINE_TEXT.railIcon,
      name: railName(next),
      effect: railEffect(next, rails),
      cost: row.cost,
      area: 'spot',
      blocked: rail === null && cutOff ? LINE_TEXT.railCutOff : null,
      craft: null,
      hint: row.requiresResearch
        ? LINE_TEXT.needsResearch
        : (LINE_TEXT.railHints[Math.min(next, LINE_TEXT.railHints.length) - 1] ??
          LINE_TEXT.railHints[0]),
    });
  }
  return cards;
}

/**
 * What a line of `level` gives back when it's taken up: the home base's
 * take-down share of everything spent on it, floored, nothing listed at 0
 * (the server's `lineRefund` in modules/lines, as roads do).
 */
export function lineRefund(
  kind: LineKind,
  level: number,
  power: PowerRules = POWER_RULES,
  rails: RailRules = RAIL_RULES,
): ItemCounts {
  const costs =
    kind === 'wire'
      ? [power.wire.cost]
      : rails.levels.slice(0, Math.max(0, level)).map((row) => row.cost);
  const spent: Record<string, number> = {};
  for (const cost of costs) {
    for (const [id, n] of Object.entries(cost)) spent[id] = (spent[id] ?? 0) + n;
  }
  const refund: Record<string, number> = {};
  for (const [id, n] of Object.entries(spent)) {
    const back = Math.floor((n * HOME_BASE_RULES.removeRefundPercent) / 100);
    if (back > 0) refund[id] = back;
  }
  return refund;
}

/** "2 🪵 3 🪨", or '' when nothing comes back. */
export function refundText(refund: ItemCounts): string {
  return Object.keys(refund).length === 0 ? '' : costShort(refund);
}
