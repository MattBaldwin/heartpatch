import type { BattleEventView, BattleSideId, PlayerBattle } from '@heartpatch/shared';
import type { SquishMove } from '../procedural/config.js';
import { PLAYBACK } from './battle-config.js';
import {
  effectivenessLine,
  isMine,
  STAT_WORDS,
  STATUS_WORDS,
  type BattleContent,
} from './battle-view.js';

/*
 * Turns the server's resolved log into a little show: one step per thing that
 * happened, with the words and the squish move to play (design doc §6, style
 * guide §3 "show, then tell"). Pure, so it's unit-tested without Babylon or
 * the DOM; the screen plays the steps with timers.
 */

export interface PlaybackStep {
  readonly kind:
    'move' | 'hit' | 'miss' | 'heal' | 'effect' | 'tuckered' | 'swap' | 'forfeit' | 'end';
  /** Whose squishy the step is about. */
  readonly side: BattleSideId;
  /** Team slot of that squishy (sides swap in and out). */
  readonly slot: number;
  /** One short line for the caption. */
  readonly text: string;
  /** A callout over the squishy ("Super cozy!"), if any. */
  readonly callout: string | null;
  /** The squish move to play on that squishy. */
  readonly squish: SquishMove | null;
  /** Energy to show on that squishy's bar after this step (bars never guess). */
  readonly energy: number | null;
  /** For swaps: who comes out. */
  readonly to: number | null;
  readonly ms: number;
}

/** What the HUD and scene show while a log plays: who is out and their energy. */
export interface ShownSide {
  readonly active: number;
  readonly energy: readonly number[];
}
export type ShownState = Readonly<Record<BattleSideId, ShownSide>>;

export function shownFrom(battle: PlayerBattle): ShownState {
  const side = (id: BattleSideId): ShownSide => ({
    active: battle.view.sides[id].active,
    energy: battle.view.sides[id].squishies.map((s) => s.energy),
  });
  return { a: side('a'), b: side('b') };
}

/** `shown` after `step`. */
export function applyStep(shown: ShownState, step: PlaybackStep): ShownState {
  let side = shown[step.side];
  const { energy } = step;
  if (energy !== null) {
    side = { ...side, energy: side.energy.map((e, i) => (i === step.slot ? energy : e)) };
  }
  if (step.kind === 'swap' && step.to !== null) side = { ...side, active: step.to };
  return { ...shown, [step.side]: side };
}

function step(
  kind: PlaybackStep['kind'],
  side: BattleSideId,
  slot: number,
  text: string,
  ms: number,
  extra: Partial<Pick<PlaybackStep, 'callout' | 'squish' | 'energy' | 'to'>> = {},
): PlaybackStep {
  return {
    kind,
    side,
    slot,
    text,
    ms,
    callout: extra.callout ?? null,
    squish: extra.squish ?? null,
    energy: extra.energy ?? null,
    to: extra.to ?? null,
  };
}

/**
 * The steps for the log entries after `fromIndex` (what the client hasn't
 * shown yet). Names come from the battle's own content, so a secret squishy
 * is named too.
 */
export function playbackSteps(
  battle: PlayerBattle,
  content: BattleContent,
  fromIndex: number,
): PlaybackStep[] {
  const name = (side: BattleSideId, slot: number): string => {
    const squishy = battle.view.sides[side].squishies[slot];
    if (!squishy) return 'Someone';
    const species = content.speciesName(squishy.speciesId);
    return isMine(battle, side) ? species : `Wild ${species}`;
  };

  return battle.view.log.slice(fromIndex).map((event: BattleEventView): PlaybackStep => {
    switch (event.type) {
      case 'move':
        return step(
          'move',
          event.side,
          event.slot,
          `${name(event.side, event.slot)} used ${content.moveName(event.move)}!`,
          PLAYBACK.moveMs,
          { squish: 'jiggle' },
        );
      case 'miss':
        return step(
          'miss',
          event.side,
          event.slot,
          `${name(event.side, event.slot)} missed! Oops.`,
          PLAYBACK.missMs,
        );
      case 'hit':
        return step(
          'hit',
          event.side,
          event.slot,
          `${name(event.side, event.slot)} lost some energy.`,
          PLAYBACK.hitMs,
          {
            callout: effectivenessLine(event.effectiveness),
            squish: 'wobble',
            energy: event.energy,
          },
        );
      case 'heal':
        return step(
          'heal',
          event.side,
          event.slot,
          `${name(event.side, event.slot)} got some energy back!`,
          PLAYBACK.effectMs,
          { squish: 'bounce', energy: event.energy },
        );
      case 'stat-change': {
        const who = name(event.side, event.slot);
        const what = STAT_WORDS[event.stat];
        const text =
          event.stages === 0
            ? `${who}'s ${what} can't go any further!`
            : event.stages > 0
              ? `${who}'s ${what} went up!`
              : `${who}'s ${what} went down.`;
        return step('effect', event.side, event.slot, text, PLAYBACK.effectMs, {
          squish: event.stages > 0 ? 'bounce' : 'jiggle',
        });
      }
      case 'status-start':
        return step(
          'effect',
          event.side,
          event.slot,
          `${name(event.side, event.slot)} ${STATUS_WORDS[event.status].start}`,
          PLAYBACK.effectMs,
          { squish: 'jiggle' },
        );
      case 'status-skip':
        return step(
          'effect',
          event.side,
          event.slot,
          `${name(event.side, event.slot)} ${STATUS_WORDS[event.status].skip}`,
          PLAYBACK.effectMs,
        );
      case 'status-end':
        return step(
          'effect',
          event.side,
          event.slot,
          `${name(event.side, event.slot)} ${STATUS_WORDS[event.status].end}`,
          PLAYBACK.effectMs,
          { squish: 'bounce' },
        );
      case 'tuckered-out':
        return step(
          'tuckered',
          event.side,
          event.slot,
          `${name(event.side, event.slot)} is all tuckered out!`,
          PLAYBACK.tuckeredMs,
          { energy: 0 },
        );
      case 'swap':
        return step(
          'swap',
          event.side,
          event.slot,
          `${name(event.side, event.slot)} hopped back. Come on out, ${name(event.side, event.to)}!`,
          PLAYBACK.swapMs,
          { to: event.to },
        );
      case 'replace':
        return step(
          'swap',
          event.side,
          event.slot,
          `Come on out, ${name(event.side, event.slot)}!`,
          PLAYBACK.swapMs,
          { to: event.slot, squish: 'bounce' },
        );
      case 'forfeit': {
        const slot = battle.view.sides[event.side].active;
        return step(
          'forfeit',
          event.side,
          slot,
          isMine(battle, event.side) ? 'You scooted away!' : `${name(event.side, slot)} ran off!`,
          PLAYBACK.swapMs,
        );
      }
      case 'battle-end': {
        const side = battle.mySide;
        const text =
          event.winner === 'draw'
            ? "It's a tie! Everyone's sleepy."
            : event.winner === side
              ? 'You won! Hooray!'
              : 'Aw, tuckered out. Next time!';
        return step('end', side, battle.view.sides[side].active, text, PLAYBACK.endMs, {
          squish: event.winner === side ? 'bounce' : null,
        });
      }
    }
  });
}
