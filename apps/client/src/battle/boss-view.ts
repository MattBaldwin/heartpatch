import {
  BOSS_WARMTH_STEPS,
  type BattleSideId,
  type ItemCounts,
  type Move,
  type PlayerBattle,
  type PlayerBattleAction,
  type PlayerBattleBoss,
} from '@heartpatch/shared';
import { itemName } from '../inventory/bag-view.js';
import { BOSS_HUD } from './battle-config.js';
import { localDateIn } from '../map/map-dressing.js';
import { coinsText, REWARD_TEXT, xpLines } from './result-card.js';
import type { ShownState } from './battle-playback.js';
import { energyPercent, otherSide, type BattleContent } from './battle-view.js';

// Pure view models for a mini-boss fight (#190, owner-approved mockups:
// arena A, picker A1, the befriend moment). The client reads what the
// server sent (CLAUDE.md rule 1): it never works out odds, damage, turn
// order or rewards, only who stands where and what the buttons say.

/** Player-facing words (style guide: cozy, short, kid-readable). */
export const BOSS_TEXT = {
  start: (name: string) => `A BIG ${name} wants to play!`,
  stompAgain: 'Stomp again!',
  round: (n: number) => `Round ${String(n)}`,
  /** `names`: the movers, in order, joined ("Pip, Puff, Bun"). */
  orderLabel: (names: string) => `Who goes when: ${names}.`,
  everyone: 'Everyone!',
  /** A move that hits every foe (`targets: 'all-foes'`). */
  areaTag: '🌀 Hits all',
  /** A move that takes a round to wind up (#234). */
  windupTag: '⏳ Winds up',
  /** The strip's chip slot while the boss winds up (#234): ⏳ shows, this is its label. */
  windingUp: '⏳ Winding up…',
  /** A team chip's label (#190): its name, energy and what it's doing. */
  chipLabel: (name: string, percent: number, doing: string) =>
    `${name}, ${String(percent)}% energy${doing ? `, ${doing}` : ''}`,
  chipDoing: {
    ok: '',
    picking: 'picking now',
    picked: 'picked',
    windup: 'winding up',
    down: 'napping',
  },
  pickHeader: (name: string) => `What should ${name} do?`,
  tuckered: 'Napping',
  ready: "Everyone's ready!",
  go: 'Go! ✨',
  changePick: 'Change a pick',
  sameAgain: 'Same again',
  triesLeft: (n: number) => `🍀 ${String(n)} ${n === 1 ? 'try' : 'tries'} left today`,
  /** The visit's last day (#190): off the fight strip since PR 1; PR 6's loss line names it. */
  hereUntil: (day: string) => `here until ${day}`,
  lastDay: 'last day!',
  // The result (mockup frames 3 and 5).
  wonTitle: 'You did it! 🎉',
  wonSub: (name: string) => `${name} sat down, puffing. It looks… friendly?`,
  lostTitle: 'So close! 💪',
  lostSub: (name: string) => `${name} is still stomping about.`,
  outTitle: (name: string) => `${name} stomped off.`,
  outSub: 'Back tomorrow!',
  outFine: (name: string) =>
    `${name} will be here again. Your squishies can have a snack and a nap first. 🍪`,
  lastDaySub: 'See you next time!',
  lastDayFine: 'That was its last day here. Another big friend will come along soon. 🍪',
  bundle: (things: string) => `You won ${things}!`,
  // One XP line for the whole team (mockup frame 3): the card stays short.
  teamXpSame: (names: string, xp: number) => `${names} each earned ${String(xp)} XP!`,
  teamXpEach: (parts: string) => `${parts}!`,
  // The befriend moment (plan §3, the #820 ruling, mockup frame 3).
  ask: (name: string) => `Ask ${name} to be your friend? 💗💗💗`,
  charmsHave: (n: number) => `💗 You have ${String(n)} Heart ${n === 1 ? 'Charm' : 'Charms'}`,
  asksLeft: 'Asks left',
  /** After "Asks left"; a phone leaves it off so the row stays one line. */
  asksLeftWin: ' this win',
  asksLeftLabel: (n: number) =>
    `You can ask ${String(n)} more ${n === 1 ? 'time' : 'times'} this win.`,
  give: (n: number) => `Give ${String(n)} Heart Charms 💗`,
  askAgain: (n: number) => `Ask again (${String(n)} 💗)`,
  needCharms: (n: number) => `You need ${String(n)} 💗`,
  makeCharms: 'Make Heart Charms 🏠',
  notYet: (name: string) => `Not yet! ${name} likes you a little more now.`,
  warmer: 'A little warmer',
  comeBack: "It'll be back next visit!",
  joined: (name: string) => `${name} joined your patch! 💗`,
  joinedSub: (name: string) => `A little ${name} hopped over to you.`,
  joinedFine: "It's a bit shy, but it likes you.",
  haveOne: (name: string) => `You already have a ${name}! 💗`,
  haveOneSub: "It's so happy to see you again.",
  asking: 'Asking…',
} as const;

/**
 * How many warmth hearts the "not yet" row shows: one per server warmth step
 * (`PlayerBattle.boss.warmth`, 0–`BOSS_WARMTH_STEPS`), plus the last heart,
 * which is the ask that always works (plan §3).
 */
export const WARMTH_HEARTS = BOSS_WARMTH_STEPS + 1; // TUNE: follows the shared step count

/** A team battle (#190): side `a` has a team out at once against one boss. */
export function isTeamBattle(b: Pick<PlayerBattle, 'view'>): boolean {
  return b.view.format !== undefined;
}

/** The slots `side` has on the field: a team's row, else just the one out. */
export function slotsOut(b: Pick<PlayerBattle, 'view'>, side: BattleSideId): readonly number[] {
  const { out, active } = b.view.sides[side];
  return out ?? [active];
}

/** The boss's slot (the other side's one out). */
export function bossSlot(b: Pick<PlayerBattle, 'view' | 'mySide'>): number {
  return b.view.sides[otherSide(b.mySide)].active;
}

export interface FriendPlate {
  readonly slot: number;
  readonly name: string;
  readonly percent: number;
  readonly energyText: string;
  readonly down: boolean;
  /** Winding up a big move (#234), as far as the log has played. */
  readonly windup: boolean;
}

export interface BossPlates {
  readonly boss: {
    readonly name: string;
    /** Off the fight strip (#190 PR 1); the entrance name card's to show. */
    readonly level: number;
    readonly percent: number;
    readonly energyText: string;
    /** Winding up a big move (#234), as far as the log has played. */
    readonly windup: boolean;
  };
  readonly friends: readonly FriendPlate[];
}

/** What the strip and the team chips show (#190 PR 1): the boss, and one entry per friend out. */
export function bossPlates(
  b: PlayerBattle,
  shown: ShownState,
  names: BattleContent,
  nameOf: (side: BattleSideId, slot: number) => string,
): BossPlates {
  const theirs = otherSide(b.mySide);
  const slot = bossSlot(b);
  const boss = b.view.sides[theirs].squishies[slot];
  const bossEnergy = shown[theirs].energy[slot] ?? boss?.energy ?? 0;
  return {
    boss: {
      name: boss ? names.speciesName(boss.speciesId) : names.speciesName(''),
      level: boss?.level ?? 1,
      percent: boss ? energyPercent({ energy: bossEnergy, stats: boss.stats }) : 0,
      energyText: boss ? `${String(bossEnergy)}/${String(boss.stats.hp)}` : '',
      windup: shown[theirs].chips[slot]?.windup ?? boss?.windup !== undefined,
    },
    friends: slotsOut(b, b.mySide).flatMap((s) => {
      const squishy = b.view.sides[b.mySide].squishies[s];
      if (!squishy) return [];
      const energy = shown[b.mySide].energy[s] ?? squishy.energy;
      return [
        {
          slot: s,
          name: nameOf(b.mySide, s),
          percent: energyPercent({ energy, stats: squishy.stats }),
          energyText: `${String(energy)}/${String(squishy.stats.hp)}`,
          down: energy <= 0,
          windup: energy > 0 && (shown[b.mySide].chips[s]?.windup ?? squishy.windup !== undefined),
        },
      ];
    }),
  };
}

// ── The phone-first boss HUD (#190 PR 1) ─────────────────────────────────

/** What a team chip's status dot says: napping wins, then the picker, then a windup. */
export type ChipStatus = 'ok' | 'picking' | 'picked' | 'windup' | 'down';

/**
 * A team chip's status (#190 PR 1): tuckered out, the squishy picking now,
 * one with its pick made, one winding up, or just there. `picker` is the
 * picker on screen, or null while a round plays.
 */
export function chipStatus(
  friend: Pick<FriendPlate, 'slot' | 'down' | 'windup'>,
  picker: Pick<PickerState, 'steps' | 'picks' | 'at'> | null,
): ChipStatus {
  if (friend.down) return 'down';
  if (picker) {
    if (picker.steps[picker.at]?.slot === friend.slot) return 'picking';
    if (picker.picks[friend.slot] !== undefined) return 'picked';
  }
  return friend.windup ? 'windup' : 'ok';
}

/** A screen for the band maths: its height and the notch's insets, CSS px. */
export interface HudScreen {
  readonly width: number;
  readonly height: number;
  readonly insetTop: number;
  readonly insetBottom: number;
}

/**
 * The stage band between the strip and the handle (#190 PR 1), fractions of
 * the height: from the strip's bottom (plus the camera's margin) to the
 * handle's top less its clearance. `safe()` measures the two edges; with
 * nothing laid out yet it guesses the rest band.
 */
export function bossBand(
  stripBottom: number,
  handleTop: number,
  height: number,
  hud: Pick<typeof BOSS_HUD, 'stripMargin' | 'handleClear'> = BOSS_HUD,
): { top: number; bottom: number } {
  const h = height || 1;
  const top = Math.min(0.4, stripBottom > 0 ? (stripBottom + hud.stripMargin) / h : 0.14);
  const bottom = handleTop > 0 ? (handleTop - hud.handleClear) / h : 0.86;
  return { top, bottom: Math.max(top + 0.2, bottom) };
}

/** Where the strip's bottom and the collapsed handle's top sit on `screen` (battle.css's numbers). */
export function bossRestEdges(
  screen: HudScreen,
  hud: Pick<typeof BOSS_HUD, 'stripTop' | 'stripHeight' | 'handleHeight'> = BOSS_HUD,
): { stripBottom: number; handleTop: number } {
  return {
    stripBottom: screen.insetTop + hud.stripTop + hud.stripHeight,
    handleTop: screen.height - screen.insetBottom - hud.handleHeight,
  };
}

/**
 * The strip's widths on a screen `width` wide (#190 PR 1, the M0 finding:
 * name, bar, ⏳ and order dots didn't fit one 393 px row). The strip has two
 * lines: the name beside the order dots, the bar beside the chip slot; this
 * is the flex layout battle.css gives them, worked out.
 */
export function bossStripWidths(
  width: number,
  hud: typeof BOSS_HUD = BOSS_HUD,
): { strip: number; name: number; bar: number; dots: number } {
  const room = width - 2 * hud.edge - hud.closeSize - hud.closeGap;
  const strip = Math.min(hud.stripMax, room);
  const inner = strip - 2 * hud.stripPad;
  const dots = hud.dots * hud.dotSize + (hud.dots - 1) * hud.dotGap;
  return {
    strip,
    name: inner - dots - hud.innerGap,
    bar: inner - hud.chipSlot - hud.innerGap,
    dots,
  };
}

/** BOSS_HUD as the custom properties battle.css reads (`--boss-*`), set on the HUD. */
export function bossHudVars(hud: typeof BOSS_HUD = BOSS_HUD): Readonly<Record<string, string>> {
  const px = (n: number) => `${String(n)}px`;
  return {
    '--boss-strip-h': px(hud.stripHeight),
    '--boss-strip-top': px(hud.stripTop),
    '--boss-strip-max': px(hud.stripMax),
    '--boss-strip-pad': px(hud.stripPad),
    '--boss-edge': px(hud.edge),
    '--boss-close': px(hud.closeSize),
    '--boss-close-gap': px(hud.closeGap),
    '--boss-handle-h': px(hud.handleHeight),
    '--boss-handle-clear': px(hud.handleClear),
    // The sheet's share is picked by screen height in battle.css (`--boss-sheet-vh`).
    '--boss-sheet-vh-tall': String(hud.sheetVh),
    '--boss-sheet-vh-840': String(hud.sheetVhShort.h840),
    '--boss-sheet-vh-700': String(hud.sheetVhShort.h700),
    '--boss-sheet-vh-600': String(hud.sheetVhShort.h600),
    '--boss-sheet-vh-sideways': String(hud.sheetVhShort.sideways),
    '--boss-chip': px(hud.chipSize),
    '--boss-chip-raise': px(hud.chipRaise),
    '--boss-dot': px(hud.dotSize),
    '--boss-dot-gap': px(hud.dotGap),
    '--boss-chip-slot': px(hud.chipSlot),
    '--boss-inner-gap': px(hud.innerGap),
    '--boss-rise': `${String(hud.riseMs)}ms`,
    '--boss-callout-lift': px(hud.calloutLift),
  };
}

/**
 * How far a friend's callout sits above its chip's top, px (its CSS `bottom`
 * past the chip). The caption pill (or a problem line) shows just above the
 * handle, centred over the chips, while a round plays: the callout then
 * stacks above it, still over its own chip, so both read and neither covers
 * the other. `stickerTop` is that pill's top (null when none shows); both
 * tops are in the same coordinates (the viewport's). `size` is the callout's
 * own laid-out box: tilted, its lower corner dips below that box by
 * (w·sin θ + h·cos θ − h) / 2, which the stack clears too.
 */
export function friendCalloutLift(
  chipTop: number,
  stickerTop: number | null,
  size: { readonly width: number; readonly height: number } = { width: 0, height: 0 },
  hud: Pick<typeof BOSS_HUD, 'calloutLift' | 'calloutGap' | 'calloutTilt'> = BOSS_HUD,
): number {
  if (stickerTop === null) return hud.calloutLift;
  const tilt = (hud.calloutTilt * Math.PI) / 180;
  const dip = Math.max(
    0,
    (size.width * Math.sin(tilt) + size.height * Math.cos(tilt) - size.height) / 2,
  );
  return Math.max(hud.calloutLift, Math.ceil(chipTop - stickerTop + dip) + hud.calloutGap);
}

// ── Picker A1 ───────────────────────────────────────────────────────────

/** One step of the team picker: a standing squishy and the moves it may use. */
export interface PickerStep {
  readonly slot: number;
  readonly name: string;
  readonly moves: readonly string[];
  /** Winding up (#234): `moves` is just the pending one, which it must pick again. */
  readonly windingUp?: boolean;
}

/**
 * The team picker (picker A1): steps through the standing squishies in slot
 * order, one move each, then Ready. `at` is the step being picked, or
 * `steps.length` once everyone has a move.
 */
export interface PickerState {
  readonly steps: readonly PickerStep[];
  readonly picks: Readonly<Record<number, string>>;
  readonly at: number;
}

/** A fresh picker for the round: who stands, in slot order (tuckered-out ones are skipped). */
export function pickerFor(
  b: PlayerBattle,
  nameOf: (side: BattleSideId, slot: number) => string,
): PickerState {
  const mine = b.view.sides[b.mySide];
  const steps = slotsOut(b, b.mySide).flatMap((slot): PickerStep[] => {
    const squishy = mine.squishies[slot];
    if (!squishy || squishy.energy <= 0 || squishy.befriended === true) return [];
    // A windup (#234) lands with the move it started: the server takes no other.
    if (squishy.windup) {
      return [
        { slot, name: nameOf(b.mySide, slot), moves: [squishy.windup.move], windingUp: true },
      ];
    }
    return [{ slot, name: nameOf(b.mySide, slot), moves: squishy.moves }];
  });
  return { steps, picks: {}, at: 0 };
}

/** The first step after `from` with no pick, or `steps.length` when all are picked. */
function nextOpen(steps: readonly PickerStep[], picks: Record<number, string>, from: number) {
  for (let i = from; i < steps.length; i++) {
    const step = steps[i];
    if (step && picks[step.slot] === undefined) return i;
  }
  for (let i = 0; i < from && i < steps.length; i++) {
    const step = steps[i];
    if (step && picks[step.slot] === undefined) return i;
  }
  return steps.length;
}

/** The current step picks `move`, and the picker moves on to the next without one. */
export function pickMove(state: PickerState, move: string): PickerState {
  const step = state.steps[state.at];
  if (!step || !step.moves.includes(move)) return state;
  const picks = { ...state.picks, [step.slot]: move };
  return { ...state, picks, at: nextOpen(state.steps, picks, state.at + 1) };
}

/** Back to a squishy's step (a tap on its chip): its pick stays until a new one replaces it. */
export function goTo(state: PickerState, slot: number): PickerState {
  const at = state.steps.findIndex((s) => s.slot === slot);
  return at < 0 ? state : { ...state, at };
}

/** True once every standing squishy has a move. */
export function pickerReady(state: PickerState): boolean {
  return state.steps.length > 0 && state.steps.every((s) => state.picks[s.slot] !== undefined);
}

/**
 * "Same again": last round's picks for whoever still stands and still knows
 * the move; anyone without one is left to pick. Null when nothing carries over.
 */
export function sameAgain(
  state: PickerState,
  last: Readonly<Record<number, string>> | null,
): PickerState | null {
  if (!last) return null;
  const picks: Record<number, string> = {};
  for (const step of state.steps) {
    const move = last[step.slot];
    if (move !== undefined && step.moves.includes(move)) picks[step.slot] = move;
  }
  if (Object.keys(picks).length === 0) return null;
  return { ...state, picks, at: nextOpen(state.steps, picks, 0) };
}

/** The `team` action the picker sends (one pick per standing squishy; the server aims). */
export function teamAction(state: PickerState): PlayerBattleAction | null {
  if (!pickerReady(state)) return null;
  return {
    type: 'team',
    picks: state.steps.map((s) => ({ slot: s.slot, move: state.picks[s.slot] ?? '' })),
  };
}

/** A move that takes a round to wind up, then lands (#234). */
export function isWindupMove(move: Pick<Move, 'effects'> | undefined | null): boolean {
  return move?.effects?.some((e) => e.type === 'windup') === true;
}

/** A move that lands on every foe at once (an area move, #190). */
export function isAreaMove(move: Pick<Move, 'targets'> | undefined | null): boolean {
  return move?.targets === 'all-foes';
}

// ── Playback ────────────────────────────────────────────────────────────

/**
 * The callout for a log step in a boss fight: "Stomp again!" on the boss's
 * second (or later) move in a round, "Everyone!" on an area move. `bossMoves`
 * counts the boss's own moves played so far this round (`isOwnMove`).
 * A move an assist called in (#234) is not the boss's own, and a landing
 * windup keeps its "Here it comes!".
 */
export function bossCallout(
  step: {
    kind: string;
    side: BattleSideId;
    move: string | null;
    backup?: boolean;
    landing?: boolean;
  },
  mySide: BattleSideId,
  bossMoves: number,
  moves: ReadonlyMap<string, Move>,
): string | null {
  if (step.kind !== 'move' || step.side === mySide) return null;
  if (step.backup === true || step.landing === true) return null;
  if (bossMoves >= 1) return BOSS_TEXT.stompAgain;
  return isAreaMove(step.move ? moves.get(step.move) : null) ? BOSS_TEXT.everyone : null;
}

/** A `move` step that is a squishy's own action this round: not one an assist called in (#234). */
export function isOwnMove(step: { kind: string; backup?: boolean }): boolean {
  return step.kind === 'move' && step.backup !== true;
}

// ── The visit's chips ───────────────────────────────────────────────────

/** A minute before the end, so a visit ending at midnight belongs to the day it covers. */
const lastMinute = (boss: Pick<PlayerBattleBoss, 'eventWindow'>) =>
  Date.parse(boss.eventWindow.endsAt) - 60_000;

/**
 * The visit's last day (#190): it ends on today's calendar day, in the
 * patch's `timeZone` when known, else this device's. A visit opening at 16:00
 * for 48 h spans three days and only the third is its last (a "less than a
 * day left" rule would say so from 16:00 on the second). Shared with the map
 * marker (190f) so the plate and the map agree.
 */
export function lastDayOf(
  boss: Pick<PlayerBattleBoss, 'eventWindow'>,
  now: number,
  timeZone: string | null = null,
): boolean {
  const end = lastMinute(boss);
  if (now >= end) return true;
  const zone = timeZone ?? '';
  return localDateIn(zone, new Date(end)) === localDateIn(zone, new Date(now));
}

/** The weekday of `ms` in `timeZone` ("Sunday"), the device's own zone if that one is unknown. */
function weekdayIn(ms: number, timeZone: string | null): string {
  const format = (zone: string | null) =>
    new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      ...(zone ? { timeZone: zone } : {}),
    }).format(new Date(ms));
  try {
    return format(timeZone);
  } catch {
    return format(null);
  }
}

/** "here until Sunday" (the visit's last day, on the patch's calendar), or "last day!". */
export function hereUntil(
  boss: Pick<PlayerBattleBoss, 'eventWindow'>,
  now: number,
  timeZone: string | null = null,
): string {
  if (lastDayOf(boss, now, timeZone)) return BOSS_TEXT.lastDay;
  return BOSS_TEXT.hereUntil(weekdayIn(lastMinute(boss), timeZone));
}

// ── The result ──────────────────────────────────────────────────────────

/** "Heart Charms" for more than one; a name already plural or uncounted ("Treats", "Heartdust") stays. */
export function countedName(n: number, name: string): string {
  return n === 1 || /(s|dust)$/i.test(name) ? name : `${name}s`;
}

/** "a, b and c". */
function listed(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;
}

/** "3 Heart Charms, 5 Heartdust and 3 Treats", in the bundle's order. */
export function bundleText(bundle: ItemCounts): string {
  return listed(bundleParts(bundle));
}

function bundleParts(bundle: ItemCounts): string[] {
  return Object.entries(bundle)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `${String(n)} ${countedName(n, itemName(id))}`);
}

/**
 * The win's one rewards line (mockup frame 3): the bundle the server put in
 * the bag, then the coins it credited, as one list ("You won 3 Heart Charms,
 * 3 Treats, 5 Patch Coins and 💛 5!"), or null when nothing came. Never a
 * client sum: each number is the server's.
 */
export function wonLine(
  bundle: ItemCounts | null | undefined,
  coins: { patch: number; heart: number } | null | undefined,
): string | null {
  const parts = bundle ? bundleParts(bundle) : [];
  // Each coin kind its own item in the list, worded as on every other card.
  if (coins && coins.patch > 0) parts.push(coinsText({ patch: coins.patch, heart: 0 }));
  if (coins && coins.heart > 0) parts.push(coinsText({ patch: 0, heart: coins.heart }));
  return parts.length > 0 ? BOSS_TEXT.bundle(listed(parts)) : null;
}

/** The fighters who earned XP, in the server's order: a benched teammate's cheer (#732) is not one. */
function teamEarned<A extends { readonly xp: number; readonly bench?: boolean }>(
  awards: readonly A[],
): A[] {
  return awards.filter((award) => award.xp > 0 && award.bench !== true);
}

/**
 * The boss card's one XP line for the whole team (mockup frame 3), or null
 * when nobody earned: "Pip, Puff and Fizz each earned 12 XP!", or each
 * one's own amount when they differ. The server's awards, as sent.
 */
export function teamXpLine(
  awards: readonly { readonly squishyId: string; readonly xp: number; readonly bench?: boolean }[],
  nameOf: (squishyId: string) => string,
): string | null {
  const earned = teamEarned(awards);
  const first = earned[0];
  if (!first) return null;
  if (earned.length === 1) return REWARD_TEXT.earnedXp(nameOf(first.squishyId), first.xp);
  if (earned.every((award) => award.xp === first.xp)) {
    return BOSS_TEXT.teamXpSame(listed(earned.map((award) => nameOf(award.squishyId))), first.xp);
  }
  return BOSS_TEXT.teamXpEach(
    listed(earned.map((award) => `${nameOf(award.squishyId)} got ${String(award.xp)}\u00a0XP`)),
  );
}

/** One fighter's compact evolving meter on the boss card (#205): its name and the gain. */
export interface TeamEvolving {
  readonly name: string;
  readonly before: number;
  readonly after: number;
}

/**
 * The boss card's row of evolving meters, one cell per fighter in
 * `teamXpLine`'s order, so the meters line up with the names. A fighter with
 * no meter (none sent) keeps a null cell; a row with no meters at all is empty.
 */
export function teamEvolvingRow(
  awards: readonly {
    readonly squishyId: string;
    readonly xp: number;
    readonly bench?: boolean;
    readonly evolvingBefore?: number | null;
    readonly evolvingAfter?: number | null;
  }[],
  nameOf: (squishyId: string) => string,
): (TeamEvolving | null)[] {
  const row = teamEarned(awards).map((award) =>
    award.evolvingBefore != null && award.evolvingAfter != null
      ? { name: nameOf(award.squishyId), before: award.evolvingBefore, after: award.evolvingAfter }
      : null,
  );
  return row.some(Boolean) ? row : [];
}

/** The boss card's XP list (#190): the team's one line, then each benched teammate's cheer. */
export interface BossXp {
  readonly xp: string[];
  /** Which lines are a bench cheer (#732), by index. */
  readonly bench: boolean[];
  /**
   * Each line's own evolving meter (#205), by index: the team's line has
   * none (its meters are `evolvingRow`), a benched cheer keeps its own.
   */
  readonly evolving: ({ before: number; after: number } | null)[];
  /** The team's meters, side by side under its line (`teamEvolvingRow`). */
  readonly evolvingRow: (TeamEvolving | null)[];
}

/**
 * The boss card's XP lines and meters from the server's awards. Empty lines
 * when nobody earned (the card says "No XP this time." itself).
 */
export function bossXp(
  awards: readonly {
    readonly squishyId: string;
    readonly xp: number;
    readonly bench?: boolean;
    readonly evolvingBefore?: number | null;
    readonly evolvingAfter?: number | null;
  }[],
  nameOf: (squishyId: string) => string,
): BossXp {
  const team = teamXpLine(awards, nameOf);
  const cheers = xpLines(awards, nameOf);
  const out: BossXp = {
    xp: team !== null ? [team] : [],
    bench: team !== null ? [false] : [],
    evolving: team !== null ? [null] : [],
    evolvingRow: teamEvolvingRow(awards, nameOf),
  };
  cheers.lines.forEach((line, i) => {
    if (!cheers.bench[i]) return;
    out.xp.push(line);
    out.bench.push(true);
    out.evolving.push(cheers.evolving[i] ?? null);
  });
  return out;
}

export interface BossResultCard {
  readonly title: string;
  readonly subtitle: string;
  /** Extra lines under the XP: the bundle with the coins, the tries chip, the fine print. */
  readonly lines: readonly string[];
  readonly outcome: 'won' | 'lost' | 'out' | 'last-day';
}

/**
 * The boss fight's card (mockup frames 3 and 5). A win names the bundle the
 * server put in the bag (never a client sum; the coins line is the usual one); a loss says how many tries
 * are left today, or that it stomped off (on its last day: "See you next
 * time!", never "Back tomorrow!"). A scoot is null: the screen's usual card.
 */
export function bossResult(
  b: PlayerBattle,
  bossName: string,
  now: number,
  timeZone: string | null = null,
): BossResultCard | null {
  const result = b.view.phase.type === 'over' ? b.view.phase.result : null;
  if (!result || b.status !== 'finished') return null;
  const boss = b.boss;
  if (result.winner === b.mySide) {
    const line = wonLine(b.rewards?.bundle, b.rewards?.coins);
    const lines = line ? [line] : [];
    return {
      title: BOSS_TEXT.wonTitle,
      subtitle: BOSS_TEXT.wonSub(bossName),
      lines,
      outcome: 'won',
    };
  }
  if (result.reason === 'forfeit') return null;
  const tries = boss?.triesLeftToday ?? 0;
  if (tries > 0) {
    return {
      title: BOSS_TEXT.lostTitle,
      subtitle: BOSS_TEXT.lostSub(bossName),
      lines: [BOSS_TEXT.triesLeft(tries)],
      outcome: 'lost',
    };
  }
  if (boss && lastDayOf(boss, now, timeZone)) {
    return {
      title: BOSS_TEXT.outTitle(bossName),
      subtitle: BOSS_TEXT.lastDaySub,
      lines: [BOSS_TEXT.lastDayFine],
      outcome: 'last-day',
    };
  }
  return {
    title: BOSS_TEXT.outTitle(bossName),
    subtitle: BOSS_TEXT.outSub,
    lines: [BOSS_TEXT.outFine(bossName)],
    outcome: 'out',
  };
}

// ── The befriend moment ─────────────────────────────────────────────────

export type BefriendView =
  | { readonly kind: 'none' }
  /** The ask: an offer, or after a "not yet" with asks left. */
  | {
      readonly kind: 'ask';
      readonly headline: string;
      /** The "not yet" line over the ask again, or null on the first ask. */
      readonly notYet: string | null;
      /** Warmth hearts lit (the server's step, 0–`BOSS_WARMTH_STEPS`), out of `WARMTH_HEARTS`. */
      readonly warmth: number;
      readonly charmsLine: string | null;
      readonly asksLeft: number;
      /** The ask button: its words, and whether it can be tapped. */
      readonly button: string;
      readonly enabled: boolean;
      /** Too few charms: show "Make Heart Charms 🏠" (where they come from) beside the ask. */
      readonly needCharms: boolean;
      /** The ask number to send (`asks made + 1`). */
      readonly ask: number;
    }
  /** A "not yet" with no asks left (or the day to ask ran out): it'll be back. */
  | {
      readonly kind: 'closed';
      readonly headline: string | null;
      readonly warmth: number;
      readonly line: string;
    }
  | {
      readonly kind: 'joined';
      readonly headline: string;
      readonly sub: string;
      readonly fine: string;
    }
  /** A duplicate never joins: no ask, no charms spent (#820). */
  | { readonly kind: 'have-one'; readonly headline: string; readonly sub: string };

/**
 * What the befriend panel shows, from the server's `boss` view: the hearts
 * are its coarse warmth step (never odds, CLAUDE.md rule 6), and the joined
 * and have-one cards name the base form that joins (#820). `name` is the
 * boss's; `asksMade`: asks this win so far; `charms`: the bag's count, null
 * while it loads.
 */
export function befriendView(input: {
  readonly boss: PlayerBattleBoss | undefined;
  readonly name: string;
  readonly asksMade: number;
  readonly charms: number | null;
}): BefriendView {
  const { boss, name, asksMade, charms } = input;
  if (!boss) return { kind: 'none' };
  const warmth = Math.min(BOSS_WARMTH_STEPS, Math.max(0, boss.warmth));
  switch (boss.befriend) {
    case 'none':
      return { kind: 'none' };
    case 'joined':
      return {
        kind: 'joined',
        headline: BOSS_TEXT.joined(boss.baseName),
        sub: BOSS_TEXT.joinedSub(boss.baseName),
        fine: BOSS_TEXT.joinedFine,
      };
    case 'have-one':
      return {
        kind: 'have-one',
        headline: BOSS_TEXT.haveOne(boss.baseName),
        sub: BOSS_TEXT.haveOneSub,
      };
    case 'offer':
    case 'not-yet': {
      const notYet = boss.befriend === 'not-yet' ? BOSS_TEXT.notYet(name) : null;
      // `offer` with no asks left: the day to ask ran out (#820, no `closed` state).
      if (boss.asksLeft <= 0) {
        return { kind: 'closed', headline: notYet, warmth, line: BOSS_TEXT.comeBack };
      }
      const cost = boss.charmsPerAsk;
      const short = charms !== null && charms < cost;
      return {
        kind: 'ask',
        headline: BOSS_TEXT.ask(name),
        notYet,
        warmth,
        charmsLine: charms === null ? null : BOSS_TEXT.charmsHave(charms),
        asksLeft: boss.asksLeft,
        button: short
          ? BOSS_TEXT.needCharms(cost)
          : notYet
            ? BOSS_TEXT.askAgain(cost)
            : BOSS_TEXT.give(cost),
        enabled: !short && charms !== null,
        needCharms: short,
        ask: asksMade + 1,
      };
    }
  }
}
