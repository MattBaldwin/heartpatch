import {
  BATTLE_RULES,
  ELEMENTS,
  FEELINGS,
  GAME_DATA,
  type BattleSideId,
  type BattleSquishyView,
  type Move,
  type PlayerBattle,
  type Species,
} from '@heartpatch/shared';

// Pure helpers over the server's battle view (`PlayerBattle`). The client only
// reads what the server sent (CLAUDE.md rule 1): it never computes damage,
// order or outcomes, just who is where and what the buttons say.

export const otherSide = (side: BattleSideId): BattleSideId => (side === 'a' ? 'b' : 'a');

/** The squishy that's out for `side`. */
export function activeOf(battle: PlayerBattle, side: BattleSideId): BattleSquishyView {
  const { squishies, active } = battle.view.sides[side];
  const squishy = squishies[active];
  if (!squishy) throw new Error(`side ${side} has no squishy in slot ${String(active)}`);
  return squishy;
}

/** Squishies on `side`'s bench that could come out: not active, not tuckered out. */
export function benchOf(
  battle: PlayerBattle,
  side: BattleSideId,
): { slot: number; squishy: BattleSquishyView }[] {
  const { squishies, active } = battle.view.sides[side];
  return squishies.flatMap((squishy, slot) =>
    slot !== active && squishy.energy > 0 ? [{ slot, squishy }] : [],
  );
}

/** Energy left as a 0–100 bar width. */
export function energyPercent(squishy: Pick<BattleSquishyView, 'energy' | 'stats'>): number {
  if (squishy.stats.hp <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((squishy.energy / squishy.stats.hp) * 100)));
}

/** Fence names by building id (#203). */
const FENCE_NAMES: ReadonlyMap<string, string> = new Map(
  GAME_DATA.buildings.filter((b) => b.kind === 'fence').map((b) => [b.id, b.name]),
);

/**
 * Names and looks for everything in a battle: the public tables plus the rows
 * the server sent along (`speciesDefs`, `moveDefs`) for species the client
 * hadn't met yet.
 */
export class BattleContent {
  readonly species: ReadonlyMap<string, Species>;
  readonly moves: ReadonlyMap<string, Move>;
  /** Fence names by building id (#203): a fence stands in for a squishy. */
  readonly fences: ReadonlyMap<string, string> = FENCE_NAMES;

  constructor(battle: Pick<PlayerBattle, 'speciesDefs' | 'moveDefs'>) {
    this.species = new Map(
      [...GAME_DATA.species, ...battle.speciesDefs].map((s): [string, Species] => [s.id, s]),
    );
    this.moves = new Map(
      [...GAME_DATA.moves, ...battle.moveDefs].map((m): [string, Move] => [m.id, m]),
    );
  }

  speciesName(id: string): string {
    return this.species.get(id)?.name ?? this.fences.get(id) ?? 'Mystery squishy';
  }

  moveName(id: string): string {
    return this.moves.get(id)?.name ?? 'Mystery move';
  }
}

/**
 * The name on a squishy's pill: its nickname where the player gave one (#141:
 * the name shown everywhere else), else its species name.
 */
export function plateName(
  content: BattleContent,
  squishy: Pick<BattleSquishyView, 'id' | 'speciesId'>,
  nicknames: ReadonlyMap<string, string> = new Map(),
): string {
  return nicknames.get(squishy.id) ?? content.speciesName(squishy.speciesId);
}

const ELEMENT_NAMES = new Map(ELEMENTS.map((e) => [e.id, e.name]));
const FEELING_NAMES = new Map(FEELINGS.map((f) => [f.id, f.name]));

/** "Shadow · Sleepy", for the info line under a nameplate; "Leaf fence" for a fence (#203). */
export function natureLine(
  squishy: Pick<BattleSquishyView, 'element' | 'feeling' | 'fence'>,
): string {
  if (squishy.fence !== undefined) {
    return `${ELEMENT_NAMES.get(squishy.element) ?? squishy.element} fence`;
  }
  return `${ELEMENT_NAMES.get(squishy.element) ?? squishy.element} · ${
    FEELING_NAMES.get(squishy.feeling) ?? squishy.feeling
  }`;
}

/** The callout for an effectiveness tier ("Super cozy!"), or null for a plain hit. */
export function effectivenessLine(tierId: string): string | null {
  return BATTLE_RULES.effectiveness.find((t) => t.id === tierId)?.line ?? null;
}

/** Player-facing words for a status (style guide: tuckered, sleepy, dizzy; never hurt). */
export const STATUS_WORDS = {
  dizzy: { start: 'is feeling dizzy!', skip: 'is too dizzy to move!', end: 'shook it off!' },
  sleepy: { start: 'dozed off!', skip: 'is fast asleep…', end: 'woke up!' },
} as const;

export const STAT_WORDS = { attack: 'oomph', defense: 'snuggliness', speed: 'zip' } as const;

/** Whose side a log entry's `side` is, from the player's point of view. */
export function isMine(battle: PlayerBattle, side: BattleSideId): boolean {
  return side === battle.mySide;
}
