import {
  BATTLE_RULES,
  GAME_DATA,
  type BattleSquishyView,
  type Move,
  type MoveEffect,
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
  /** The icon and word on the kind chip. */
  look: { icon: string; label: string };
  /** One plain line: "Heals you 35%", "Makes them sleepy". */
  line: string;
  /** The number on the kind chip: a boop's power ("65"); null when the line already says it. */
  number: string | null;
  edge: MoveEdge | null;
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
  // The tiers with a callout line ("Super cozy!", "Just a little boop.") are the notable ones.
  if (!tier || effectivenessLine(tier.id) === null) return null;
  return multiplier >= 1 ? 'strong' : 'weak';
}

export function describeMove(
  move: Move,
  me: Pick<BattleSquishyView, 'feeling'>,
  them: Pick<BattleSquishyView, 'element' | 'feeling' | 'fence'>,
): MoveInfo {
  const kind = kindOf(move);
  const number = kind === 'boop' ? String(move.power) : null;
  // A boop's side effects ride in the "More" view (and as a small mark on the button).
  const more = [move.description];
  if (move.power > 0) more.push(`Lands ${String(move.accuracy)}% of the time.`);
  else if (move.accuracy < 100) more.push(`Works ${String(move.accuracy)}% of the time.`);
  const line = lineOf(move, kind);
  for (const effect of move.effects ?? []) {
    const sentence = effectSentence(effect);
    // The button's own line already says it; the card adds only what is new.
    if (sentence !== `${line}.`) more.push(sentence);
  }
  const status = (move.effects ?? []).find((e) => e.type === 'status');
  const look =
    kind === 'status' && status?.type === 'status' ? STATUS_LOOKS[status.status] : MOVE_KINDS[kind];
  return { kind, look, line, number, edge: moveEdge(move, me, them), more };
}

/** The words a screen reader gets for the whole button. */
export function moveLabel(name: string, info: MoveInfo): string {
  const parts = [name, info.look.label, info.line];
  if (info.number) parts.push(`Power ${info.number}`);
  if (info.edge) parts.push(`${EDGE_WORDS[info.edge].label} against them`);
  return parts.join('. ');
}
