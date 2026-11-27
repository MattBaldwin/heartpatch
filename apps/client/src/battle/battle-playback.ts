import type {
  BattleEventView,
  BattleSideId,
  BattleStatusId,
  PlayerBattle,
} from '@heartpatch/shared';
import type { SquishMove } from '../procedural/config.js';
import { PLAYBACK } from './battle-config.js';
import {
  chipsAfterDrinking,
  chipsOf,
  SHIELD_CALLOUT,
  SHIELD_LINE,
  sipLine,
  type PlateChips,
} from './potions.js';
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
    | 'move'
    | 'hit'
    | 'miss'
    | 'heal'
    | 'effect'
    | 'tuckered'
    | 'swap'
    | 'forfeit'
    | 'capture'
    /** A potion (#214). */
    | 'item'
    | 'end';
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
  /** For moves and misses: the move used (the arena picks its element's effects). */
  readonly move: string | null;
  /** For hits: the effectiveness tier (`super` hits land harder in the arena). */
  readonly effectiveness: string | null;
  /** For a status starting or showing again: which one (the arena shows its stars or bubbles). */
  readonly status: BattleStatusId | null;
  /** For items: which potion. */
  readonly item: string | null;
  /** For hits: a potion's sparkle shield took most of it, and pops. */
  readonly shielded: boolean;
  /** For a steady or big move (#587): the stance its user takes, until the next hit. */
  readonly stance: 'guard' | 'open' | null;
  /**
   * A `windup` step (#234): its squishy started winding up a move that lands
   * next round. Optional so steps built elsewhere needn't say false.
   */
  readonly windup?: boolean;
  /** A `windup-lost` step (#234): its squishy's ⏳ chip goes. */
  readonly windupLost?: boolean;
  /**
   * A charge-round `move` (#234): a `windup` step follows, so the arena plays
   * the wind-up, not a strike that never lands.
   */
  readonly charge?: boolean;
  /** The `move` an `assist` called in (#234): not its user's own action. */
  readonly backup?: boolean;
  /** The `move` a windup lands with (#234): its callout is "Here it comes!". */
  readonly landing?: boolean;
  /** A `flinch` step (#234): its squishy loses its action (a signature beat, #190 PR 5). */
  readonly flinch?: boolean;
  /** An `assist` step (#234): its squishy calls a friend's move in (`move`). */
  readonly assist?: boolean;
  readonly ms: number;
}

/** What the HUD and scene show while a log plays: who is out and their energy. */
export interface ShownSide {
  readonly active: number;
  readonly energy: readonly number[];
  /** Each squishy's potion chips (#214), as far as the log has played. */
  readonly chips: readonly PlateChips[];
}
export type ShownState = Readonly<Record<BattleSideId, ShownSide>>;

/** What the log says about Steady and Big moves (#587), style guide §3. */
export const STANCE_WORDS = {
  guard: (who: string) => `${who}'s guard is up!`,
  open: (who: string) => `${who} is wide open!`,
  guarded: (who: string) => `${who} was on guard. Just a little bump!`,
  opened: (who: string) => `${who} was wide open. Big bump!`,
  gentle: (who: string) => `${who} is holding on by a whisker!`,
  /** A gentle move that did nothing: say what will. */
  whisker: (who: string) => `${who} is holding on by a whisker! Try a Big move or a Heart Charm.`,
  gentleCallout: 'So gentle!',
} as const;

/** What the log says about the #234 move effects, style guide §3. */
export const EFFECT_WORDS = {
  windup: (who: string, move: string) => `${who} is winding up ${move}… watch out next round!`,
  windupCallout: 'Winding up!',
  /** Callout on the `move` step when that squishy's windup lands. */
  windupLanding: 'Here it comes!',
  /** A foe's windup that fizzled. */
  windupLost: (who: string) => `${who} lost count! Phew.`,
  /** The player's own squishy lost its windup (a flinch, a swap, a bare potion). */
  windupLostMine: (who: string) => `${who} lost count. Wind up again next time!`,
  flinch: (who: string) => `${who} flinched! No move this round.`,
  flinchCallout: 'Flinched!',
  /** Callout on a low-energy move when its user is at half energy or less. */
  firedUp: 'Fired up! 🔥',
  assist: (who: string) => `${who} called for backup! 📣`,
  /** The `move` step right after an `assist` for the same squishy. */
  backup: (move: string) => `Backup! ${move}!`,
} as const;

export function shownFrom(battle: PlayerBattle): ShownState {
  const side = (id: BattleSideId): ShownSide => ({
    active: battle.view.sides[id].active,
    energy: battle.view.sides[id].squishies.map((s) => s.energy),
    chips: battle.view.sides[id].squishies.map(chipsOf),
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
  const { item, stance } = step;
  // A hit uses up a stance (#587); a swap drops it; a steady or big move takes one.
  const clears = step.kind === 'hit' || step.kind === 'swap';
  // A windup (#234): on at its `windup` step; off at that squishy's next
  // move (it lands), when it's lost, at a swap or when it tuckers out.
  const windupOff =
    step.kind === 'move' || step.kind === 'swap' || step.windupLost === true || energy === 0;
  const windupOn = step.windup === true;
  if (
    (item !== null && step.kind === 'item') ||
    step.shielded ||
    clears ||
    stance !== null ||
    windupOn ||
    windupOff
  ) {
    side = {
      ...side,
      chips: side.chips.map((c, i) => {
        if (i !== step.slot) return c;
        if (item !== null && step.kind === 'item') return chipsAfterDrinking(c, item);
        let next = step.shielded ? { ...c, shield: false } : c;
        if (clears) next = { ...next, guard: false, open: false };
        if (stance !== null) next = { ...next, guard: stance === 'guard', open: stance === 'open' };
        if (windupOn) next = { ...next, windup: true };
        else if (windupOff && next.windup) next = { ...next, windup: false };
        return next;
      }),
    };
  }
  return { ...shown, [step.side]: side };
}

function step(
  kind: PlaybackStep['kind'],
  side: BattleSideId,
  slot: number,
  text: string,
  ms: number,
  extra: Partial<
    Pick<
      PlaybackStep,
      | 'callout'
      | 'squish'
      | 'energy'
      | 'to'
      | 'move'
      | 'effectiveness'
      | 'status'
      | 'item'
      | 'shielded'
      | 'stance'
      | 'windup'
      | 'windupLost'
      | 'charge'
      | 'backup'
      | 'landing'
      | 'flinch'
      | 'assist'
    >
  > = {},
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
    move: extra.move ?? null,
    effectiveness: extra.effectiveness ?? null,
    status: extra.status ?? null,
    item: extra.item ?? null,
    shielded: extra.shielded ?? false,
    stance: extra.stance ?? null,
    windup: extra.windup ?? false,
    ...(extra.windupLost === true && { windupLost: true }),
    ...(extra.charge === true && { charge: true }),
    ...(extra.backup === true && { backup: true }),
    ...(extra.landing === true && { landing: true }),
    ...(extra.flinch === true && { flinch: true }),
    ...(extra.assist === true && { assist: true }),
  };
}

/**
 * The sip's own little show when a potion is tapped (#403), before the turn
 * goes out: the same bounce and sparkle the log's `item` step plays, on the
 * player's squishy that's out.
 */
export function sipStep(battle: PlayerBattle, content: BattleContent, item: string): PlaybackStep {
  const side = battle.mySide;
  const slot = battle.view.sides[side].active;
  const squishy = battle.view.sides[side].squishies[slot];
  const who = squishy ? content.speciesName(squishy.speciesId) : 'Your squishy';
  return step('item', side, slot, sipLine(who, item), PLAYBACK.itemMs, {
    squish: 'bounce',
    item,
  });
}

/** A fence's lines (#203, the owner-approved mockup): it creaks, then cracks. */
export const FENCE_LINES = {
  hit: (name: string) => `${name} creaks…`,
  down: (name: string) => `Crack! ${name} fell down! 🪵`,
  broke: 'The fence is down! Hooray!',
  held: 'The fence held! Next time!',
  stopped: 'You stopped for now. The fence keeps what it lost.',
  replayHeld: 'Your fence held!',
} as const;

/** The last line of a fence battle (#203): `won` is the watching side's win. */
function fenceEndLine(won: boolean | 'draw', reason: string): string {
  if (won === 'draw') return FENCE_LINES.held;
  if (won) return reason === 'turn-limit' ? FENCE_LINES.replayHeld : FENCE_LINES.broke;
  return reason === 'forfeit' ? FENCE_LINES.stopped : FENCE_LINES.held;
}

/** What a `move` step says beyond "used X!" (#234), from where it sits in the log. */
interface MoveCue {
  /** A `windup` follows: the charge round. */
  readonly charge: boolean;
  /** Its user was winding this up: it lands now. */
  readonly landing: boolean;
  /** An `assist` just called it in. */
  readonly backup: boolean;
  /** A low-energy move, and its user is at `FIRED_UP_AT_OR_BELOW`% energy or less. */
  readonly firedUp: boolean;
}

/** "Fired up!" shows once a low-energy move's user is at or below this % of its energy. */
const FIRED_UP_AT_OR_BELOW = 50; // TUNE: the cue only; the engine's low-energy bonus scales smoothly

/**
 * The #234 cues for every `move` in the log, by log index. The whole log is
 * read, so a windup started in an earlier round still lands with its callout.
 * "Fired up!" reads the mover's energy at that moment from the nearest event
 * that reports it: the last earlier `hit`/`heal` on that slot (its `energy`),
 * else the next later one (its `energy` before the `amount` moved), else the
 * view. No running sum, so an event that changes energy some other way can't
 * skew it.
 */
function moveCues(battle: PlayerBattle, content: BattleContent): Map<number, MoveCue> {
  const { log, sides } = battle.view;
  const key = (side: BattleSideId, slot: number) => `${side}:${String(slot)}`;
  /** Each low-energy `move` (by log index) and its user's full energy. */
  const lowMoves = new Map<number, number>();
  const energyAt = new Map<number, number>();
  const last = new Map<string, number>();
  log.forEach((event, i) => {
    if (event.type === 'forfeit' || event.type === 'battle-end') return;
    const at = key(event.side, event.slot);
    if (event.type === 'hit' || event.type === 'heal') last.set(at, event.energy);
    else if (event.type === 'move') {
      const low = content.moves.get(event.move)?.effects?.some((e) => e.type === 'low-energy');
      const hp = sides[event.side].squishies[event.slot]?.stats.hp ?? 0;
      if (low !== true || hp <= 0) return;
      lowMoves.set(i, hp);
      const known = last.get(at);
      if (known !== undefined) energyAt.set(i, known);
    }
  });
  const next = new Map<string, number>();
  for (const side of ['a', 'b'] as const) {
    sides[side].squishies.forEach((s, slot) => next.set(key(side, slot), s.energy));
  }
  for (let i = log.length - 1; i >= 0; i--) {
    const event = log[i];
    if (!event || event.type === 'forfeit' || event.type === 'battle-end') continue;
    const at = key(event.side, event.slot);
    if (event.type === 'hit') next.set(at, event.energy + event.amount);
    else if (event.type === 'heal') next.set(at, event.energy - event.amount);
    else if (lowMoves.has(i) && !energyAt.has(i)) energyAt.set(i, next.get(at) ?? 0);
  }
  const firedUp = new Set<number>();
  lowMoves.forEach((hp, i) => {
    if ((energyAt.get(i) ?? hp) * 100 <= hp * FIRED_UP_AT_OR_BELOW) firedUp.add(i);
  });
  const cues = new Map<number, MoveCue>();
  const winding = new Set<string>();
  log.forEach((event, i) => {
    if (event.type === 'forfeit' || event.type === 'battle-end') return;
    const at = key(event.side, event.slot);
    if (event.type === 'move') {
      const next = log[i + 1];
      const prev = log[i - 1];
      cues.set(i, {
        charge: next?.type === 'windup' && next.side === event.side && next.slot === event.slot,
        landing: winding.has(at),
        backup: prev?.type === 'assist' && prev.side === event.side && prev.slot === event.slot,
        firedUp: firedUp.has(i),
      });
      winding.delete(at);
    } else if (event.type === 'windup') winding.add(at);
    else if (event.type === 'windup-lost' || event.type === 'swap' || event.type === 'tuckered-out')
      winding.delete(at);
  });
  return cues;
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
  /** A live battle's other Keeper (#29): "Mira's Puddlepuff", never "Wild". */
  options: { opponent?: string | null } = {},
): PlaybackStep[] {
  const name = (side: BattleSideId, slot: number): string => {
    const squishy = battle.view.sides[side].squishies[slot];
    if (!squishy) return 'Someone';
    const species = content.speciesName(squishy.speciesId);
    // A fence (#203) is a thing, not a squishy: "The Hedge".
    if (squishy.fence !== undefined) return `The ${species}`;
    if (isMine(battle, side)) return species;
    // A mini-boss (#190) is a visitor, not a wild squishy: just its name.
    if (squishy.boss === true) return species;
    if (battle.live)
      return options.opponent ? `${options.opponent}'s ${species}` : `Their ${species}`;
    return `Wild ${species}`;
  };
  const isFence = (side: BattleSideId, slot: number): boolean =>
    battle.view.sides[side].squishies[slot]?.fence !== undefined;

  const cues = moveCues(battle, content);

  return battle.view.log.slice(fromIndex).map((event: BattleEventView, i): PlaybackStep => {
    switch (event.type) {
      case 'move': {
        const cue = cues.get(fromIndex + i);
        const move = content.moveName(event.move);
        return step(
          'move',
          event.side,
          event.slot,
          cue?.backup === true
            ? EFFECT_WORDS.backup(move)
            : `${name(event.side, event.slot)} used ${move}!`,
          PLAYBACK.moveMs,
          {
            squish: 'jiggle',
            move: event.move,
            callout: cue?.landing
              ? EFFECT_WORDS.windupLanding
              : cue?.firedUp
                ? EFFECT_WORDS.firedUp
                : null,
            charge: cue?.charge === true,
            backup: cue?.backup === true,
            landing: cue?.landing === true,
          },
        );
      }
      case 'miss':
        return step(
          'miss',
          event.side,
          event.slot,
          `${name(event.side, event.slot)} missed! Oops.`,
          PLAYBACK.missMs,
          { move: event.move },
        );
      case 'hit':
        return step(
          'hit',
          event.side,
          event.slot,
          event.gentle
            ? event.amount === 0
              ? STANCE_WORDS.whisker(name(event.side, event.slot))
              : STANCE_WORDS.gentle(name(event.side, event.slot))
            : event.shielded
              ? SHIELD_LINE
              : isFence(event.side, event.slot)
                ? FENCE_LINES.hit(name(event.side, event.slot))
                : event.guarded
                  ? STANCE_WORDS.guarded(name(event.side, event.slot))
                  : event.opened
                    ? STANCE_WORDS.opened(name(event.side, event.slot))
                    : `${name(event.side, event.slot)} lost some energy.`,
          PLAYBACK.hitMs,
          {
            callout: event.gentle
              ? STANCE_WORDS.gentleCallout
              : event.shielded
                ? SHIELD_CALLOUT
                : effectivenessLine(event.effectiveness),
            squish: 'wobble',
            energy: event.energy,
            effectiveness: event.effectiveness,
            shielded: event.shielded === true,
          },
        );
      case 'stance':
        return step(
          'effect',
          event.side,
          event.slot,
          STANCE_WORDS[event.stance](name(event.side, event.slot)),
          PLAYBACK.effectMs,
          { squish: event.stance === 'guard' ? 'bounce' : 'jiggle', stance: event.stance },
        );
      case 'item':
        return step(
          'item',
          event.side,
          event.slot,
          sipLine(name(event.side, event.slot), event.item),
          PLAYBACK.itemMs,
          { squish: 'bounce', item: event.item },
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
          { squish: 'jiggle', status: event.status },
        );
      case 'status-skip':
        return step(
          'effect',
          event.side,
          event.slot,
          `${name(event.side, event.slot)} ${STATUS_WORDS[event.status].skip}`,
          PLAYBACK.effectMs,
          { status: event.status },
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
      case 'windup':
        return step(
          'effect',
          event.side,
          event.slot,
          EFFECT_WORDS.windup(name(event.side, event.slot), content.moveName(event.move)),
          PLAYBACK.effectMs,
          { squish: 'jiggle', callout: EFFECT_WORDS.windupCallout, move: event.move, windup: true },
        );
      case 'windup-lost':
        return step(
          'effect',
          event.side,
          event.slot,
          (isMine(battle, event.side) ? EFFECT_WORDS.windupLostMine : EFFECT_WORDS.windupLost)(
            name(event.side, event.slot),
          ),
          PLAYBACK.effectMs,
          { move: event.move, windupLost: true },
        );
      case 'flinch':
        return step(
          'effect',
          event.side,
          event.slot,
          EFFECT_WORDS.flinch(name(event.side, event.slot)),
          PLAYBACK.effectMs,
          { squish: 'wobble', callout: EFFECT_WORDS.flinchCallout, flinch: true },
        );
      case 'assist':
        return step(
          'effect',
          event.side,
          event.slot,
          EFFECT_WORDS.assist(name(event.side, event.slot)),
          PLAYBACK.effectMs,
          { squish: 'bounce', move: event.move, assist: true },
        );
      case 'tuckered-out':
        return step(
          'tuckered',
          event.side,
          event.slot,
          isFence(event.side, event.slot)
            ? FENCE_LINES.down(name(event.side, event.slot))
            : `${name(event.side, event.slot)} is all tuckered out!`,
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
      case 'capture': {
        // The Heart Charm lands on the wild squishy: it bounces with joy and
        // comes along, or wiggles free (style guide §9: "befriend").
        const species = content.speciesName(
          battle.view.sides[event.side].squishies[event.slot]?.speciesId ?? '',
        );
        return step(
          'capture',
          event.side,
          event.slot,
          event.caught
            ? `Heart Charm! ${species} wants to be friends!`
            : `Heart Charm! ${name(event.side, event.slot)} wiggled free.`,
          PLAYBACK.captureMs,
          { squish: event.caught ? 'bounce' : 'wobble' },
        );
      }
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
        const fence = (['a', 'b'] as const).some((s) =>
          battle.view.sides[s].squishies.some((q) => q.fence !== undefined),
        );
        const text = fence
          ? fenceEndLine(event.winner === 'draw' ? 'draw' : event.winner === side, event.reason)
          : event.winner === 'draw'
            ? "It's a tie! Everyone's sleepy."
            : event.winner === side
              ? event.reason === 'captured'
                ? 'A new friend! Hooray!'
                : 'You won! Hooray!'
              : event.reason === 'forfeit'
                ? 'You scooted home. Maybe next time!'
                : 'Aw, tuckered out. Next time!';
        return step('end', side, battle.view.sides[side].active, text, PLAYBACK.endMs, {
          squish: event.winner === side ? 'bounce' : null,
        });
      }
    }
  });
}
