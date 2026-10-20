import {
  BATTLE_RULES,
  GAME_DATA,
  type BattleSquishyView,
  type Move,
  type MoveEffect,
  type MoveKind as MoveStyle,
} from '@heartpatch/shared';
import { effectivenessLine, STAT_WORDS } from './battle-view.js';

// What a move button says about its move (issue #565): a kind (icon, word and
// colour together, never colour alone), one plain line, and the numbers worth
// a glance. Everything is derived from the move's own data (`power`,
// `accuracy`, `effects`), so a new move needs no copy here. The matchup hint
// reads the public matrices the callout already uses, so it is a hint, not an
// outcome: the server still decides what happens (CLAUDE.md rule 1).

export type MoveKind = 'boop' | 'heal' | 'shield' | 'boost' | 'weaken' | 'status';

/** Icon and word for each kind. "Boop" because the style guide bars "attack" in the UI. */
export const MOVE_KINDS: Readonly<Record<MoveKind, { icon: string; label: string }>> = {
  boop: { icon: '💥', label: 'Boop' },
  heal: { icon: '💗', label: 'Heal' },
  shield: { icon: '🛡️', label: 'Shield' },
  boost: { icon: '⬆️', label: 'Boost' },
  weaken: { icon: '⬇️', label: 'Weaken' },
  status: { icon: '💫', label: 'Daze' },
};

/**
 * Steady and Big (#587): a boop says which it is, on this squishy. The server
 * decides what happens; this only reads the same rule (`speciesMoveKinds`).
 */
export const STYLE_LOOKS: Readonly<Record<MoveStyle, { icon: string; label: string }>> = {
  big: { icon: '💥', label: 'Big' },
  steady: { icon: '🛡️', label: 'Steady' },
};

const STYLE_LINES: Readonly<Record<MoveStyle, string>> = {
  big: 'Hits hard, leaves you open',
  steady: 'Lighter, raises your guard',
};

/** The ⓘ explainer (owner follow-up on #587): what Big and Steady mean, kid-readable. */
export const STYLE_MORE: Readonly<Record<MoveStyle, string>> = {
  big: 'A big hit! But it leaves you open, so the next boop you get is a bit bigger.',
  steady:
    "A lighter hit that keeps your guard up, so the next boop you get is a bit smaller. On a wild squishy it's gentle: it never tuckers them out, so you can befriend them with a Heart Charm.",
};

/** The gentle hint (#587), when a Heart Charm is in reach. */
export const GENTLE_HINT = 'Gentle! Leaves a sliver for a Heart Charm';

/** The gentle hint shows once they are below this % of their energy. */
export const GENTLE_HINT_BELOW = 50; // TUNE: "in reach of a Heart Charm"

/**
 * Whether steady boops wear the gentle hint (#587): a gentle battle, a
 * squishy (not a fence) below `GENTLE_HINT_BELOW`% energy, and a Heart Charm
 * in the bag.
 */
export function gentleHintShows(
  battle: { readonly gentle?: true | undefined },
  them: Pick<BattleSquishyView, 'energy' | 'stats' | 'fence'>,
  charms: number | null,
): boolean {
  return (
    battle.gentle === true &&
    them.fence === undefined &&
    (charms ?? 0) > 0 &&
    them.energy * 100 < GENTLE_HINT_BELOW * them.stats.hp
  );
}

/** A status move says which one: dizzy or sleepy reads better than a generic word. */
const STATUS_LOOKS = {
  dizzy: { icon: '💫', label: 'Dizzy' },
  sleepy: { icon: '💤', label: 'Sleepy' },
} as const;

/** How a boop fares against who is out now; null for a plain matchup or a move that is no boop. */
export type MoveEdge = 'strong' | 'weak';

export const EDGE_WORDS: Readonly<Record<MoveEdge, { icon: string; label: string }>> = {
  strong: { icon: '▲', label: 'Strong' },
  weak: { icon: '▼', label: 'Weak' },
};

export interface MoveInfo {
  kind: MoveKind;
  /** A boop's style (#587): big or steady on this squishy; null for other moves. */
  style: MoveStyle | null;
  /** The icon and word on the kind chip. */
  look: { icon: string; label: string };
  /** One plain line: "Heals you 35%", "Makes them sleepy". */
  line: string;
  /** The number on the kind chip: a boop's power ("65"); null when the line already says it. */
  number: string | null;
  edge: MoveEdge | null;
  /** "90% hits" when the move can miss; null when it always lands. */
  hits: string | null;
  /** The gentle hint (#587) on a steady boop when a Heart Charm is in reach. */
  hint: string | null;
  /** The longer card (the "More" view): the move's own description and what else can happen. */
  more: string[];
}

const stagesWord = (stages: number): string => (Math.abs(stages) >= 2 ? 'way ' : '');
const list = (words: string[]): string =>
  words.length > 1
    ? `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`
    : (words[0] ?? '');

/** "Your oomph goes up", "Their zip goes way down". */
function statLine(effects: Extract<MoveEffect, { type: 'stat' }>[]): string {
  const first = effects[0];
  if (!first) return '';
  const who = first.target === 'self' ? 'Your' : 'Their';
  const words = list(effects.map((e) => STAT_WORDS[e.stat]));
  const way = first.stages > 0 ? 'up' : 'down';
  return `${who} ${words} ${effects.length > 1 ? 'go' : 'goes'} ${stagesWord(first.stages)}${way}`;
}

/** The effect as a plain sentence for the "More" view, with its chance when it's not sure. */
function effectSentence(effect: MoveEffect): string {
  switch (effect.type) {
    case 'heal':
      return `Heals you ${String(effect.percent)}%.`;
    case 'status': {
      const word = effect.status === 'dizzy' ? 'dizzy' : 'sleepy';
      return effect.chance >= 100
        ? `Makes them ${word}.`
        : `${String(effect.chance)}% chance to make them ${word}.`;
    }
    case 'stat': {
      const who = effect.target === 'self' ? 'your' : 'their';
      const way = effect.stages > 0 ? 'up' : 'down';
      const line = `${who.charAt(0).toUpperCase()}${who.slice(1)} ${STAT_WORDS[effect.stat]} goes ${stagesWord(effect.stages)}${way}.`;
      return effect.chance >= 100 ? line : `${String(effect.chance)}% chance: ${line}`;
    }
  }
}

function kindOf(move: Move): MoveKind {
  if (move.power > 0) return 'boop';
  const effects = move.effects ?? [];
  if (effects.some((e) => e.type === 'heal')) return 'heal';
  const stat = effects.find((e) => e.type === 'stat');
  if (stat?.type === 'stat') {
    if (stat.target === 'opponent') return 'weaken';
    return stat.stat === 'defense' ? 'shield' : 'boost';
  }
  return 'status';
}

function lineOf(move: Move, kind: MoveKind): string {
  const effects = move.effects ?? [];
  switch (kind) {
    case 'boop':
      return 'Takes their energy';
    case 'heal': {
      const heal = effects.find((e) => e.type === 'heal');
      return heal?.type === 'heal' ? `Heals you ${String(heal.percent)}%` : 'Heals you';
    }
    case 'shield':
    case 'boost':
    case 'weaken':
      return statLine(
        effects.filter(
          (e): e is Extract<MoveEffect, { type: 'stat' }> =>
            e.type === 'stat' && e.target === (kind === 'weaken' ? 'opponent' : 'self'),
        ),
      );
    case 'status': {
      const status = effects.find((e) => e.type === 'status');
      if (status?.type !== 'status') return 'Does something sneaky';
      const word = status.status === 'dizzy' ? 'dizzy' : 'sleepy';
      return status.chance >= 100 ? `Makes them ${word}` : `Might make them ${word}`;
    }
  }
}

/**
 * Strong or weak for this boop into this opponent: the element table times
 * the feeling table (the same product the engine uses), read against the
 * rules' effectiveness tiers. A fence has no feeling, so only its element counts.
 */
export function moveEdge(
  move: Move,
  me: Pick<BattleSquishyView, 'feeling'>,
  them: Pick<BattleSquishyView, 'element' | 'feeling' | 'fence'>,
): MoveEdge | null {
  if (move.power <= 0) return null;
  const feeling = them.fence === undefined ? GAME_DATA.feelingMatrix[me.feeling][them.feeling] : 1;
  const multiplier = GAME_DATA.elementMatrix[move.element][them.element] * feeling;
  const tier = BATTLE_RULES.effectiveness.find((t) => multiplier >= t.atLeast);
  // The tiers with a callout line ("Super cozy!", "Just a little boop.") are the notable ones;
  // a tier that starts at 1 or more is a strength, one below it a weakness.
  if (!tier || effectivenessLine(tier.id) === null) return null;
  return tier.atLeast >= 1 ? 'strong' : 'weak';
}

/** What a button says when the move's row is missing (the server sent no definition). */
export const UNKNOWN_MOVE_INFO: MoveInfo = {
  kind: 'status',
  style: null,
  look: MOVE_KINDS.status,
  line: 'A mystery move',
  number: null,
  edge: null,
  hits: null,
  hint: null,
  more: [],
};

/** What the battle adds to a move's own data (#587). */
export interface MoveContext {
  /** Big or steady for the squishy using it. */
  readonly style?: MoveStyle | undefined;
  /** The battle is gentle and a Heart Charm is in reach: say so on a steady boop. */
  readonly gentleHint?: boolean;
}

export function describeMove(
  move: Move,
  me: Pick<BattleSquishyView, 'feeling'>,
  them: Pick<BattleSquishyView, 'element' | 'feeling' | 'fence'>,
  context: MoveContext = {},
): MoveInfo {
  const kind = kindOf(move);
  const style = kind === 'boop' ? (context.style ?? null) : null;
  const number = kind === 'boop' ? String(move.power) : null;
  // A boop's side effects ride in the "More" view (and as a small mark on the button).
  const more = [move.description];
  if (move.power > 0) more.push(`Lands ${String(move.accuracy)}% of the time.`);
  else if (move.accuracy < 100) more.push(`Works ${String(move.accuracy)}% of the time.`);
  const line = style ? STYLE_LINES[style] : lineOf(move, kind);
  if (style) more.push(STYLE_MORE[style]);
  for (const effect of move.effects ?? []) {
    const sentence = effectSentence(effect);
    // The button's own line already says it; the card adds only what is new.
    if (sentence !== `${line}.`) more.push(sentence);
  }
  const status = (move.effects ?? []).find((e) => e.type === 'status');
  const look = style
    ? STYLE_LOOKS[style]
    : kind === 'status' && status?.type === 'status'
      ? STATUS_LOOKS[status.status]
      : MOVE_KINDS[kind];
  return {
    kind,
    style,
    look,
    line,
    number,
    edge: moveEdge(move, me, them),
    hits: move.accuracy < 100 ? `${String(move.accuracy)}% hits` : null,
    hint: style === 'steady' && context.gentleHint ? GENTLE_HINT : null,
    more,
  };
}

/** The words a screen reader gets for the whole button. */
export function moveLabel(name: string, info: MoveInfo): string {
  const parts = [name, info.look.label, info.line];
  if (info.number) parts.push(`Power ${info.number}`);
  if (info.hits) parts.push(info.hits);
  if (info.edge) parts.push(`${EDGE_WORDS[info.edge].label} against them`);
  if (info.hint) parts.push(info.hint);
  return parts.join('. ');
}
