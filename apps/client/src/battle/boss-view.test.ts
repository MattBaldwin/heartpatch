import { BATTLE_RULES, findAvoidedWords, GAME_DATA, type PlayerBattle } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { shownFrom } from './battle-playback.js';
import { REWARD_TEXT } from './result-card.js';
import { BattleContent } from './battle-view.js';
import {
  BOSS_TEXT,
  befriendView,
  bossCallout,
  isOwnMove,
  isWindupMove,
  bossPlates,
  bossResult,
  bundleText,
  bossXp,
  teamEvolvingRow,
  teamXpLine,
  wonLine,
  goTo,
  hereUntil,
  isAreaMove,
  isTeamBattle,
  lastDayOf,
  WARMTH_HEARTS,
  pickerFor,
  pickerReady,
  pickMove,
  sameAgain,
  slotsOut,
  teamAction,
  stompsChip,
} from './boss-view.js';

const NOW = Date.parse('2026-11-14T12:00:00.000Z');
const species = GAME_DATA.species.filter((s) => s.moves.length >= 2);
const [pip, bun, moss, boss] = [species[0]!, species[1]!, species[2]!, species[3]!];

function squishy(s: (typeof species)[number], i: number, energy = 40, hp = 40) {
  return {
    id: `00000000-0000-7000-8000-00000000000${String(i)}`,
    speciesId: s.id,
    level: 10,
    element: s.element,
    feeling: s.feeling,
    energy,
    stats: { hp, attack: 10, defense: 10, speed: 10 },
    stages: { attack: 0, defense: 0, speed: 0 },
    boosts: { attack: 0, defense: 0 },
    shield: 0,
    status: null,
    moves: s.moves,
  };
}

function battle(
  team = 3,
  over: Partial<PlayerBattle> = {},
  energies: readonly number[] = [40, 40, 40],
): PlayerBattle {
  const mine = [pip, bun, moss].slice(0, team).map((s, i) => squishy(s, i, energies[i] ?? 40));
  return {
    id: '00000000-0000-7000-8000-0000000000aa',
    kind: 'miniboss',
    status: 'active',
    mySide: 'a',
    rewards: null,
    view: {
      turn: 2,
      format: { a: team as 1 | 2 | 3, b: 1 },
      phase: { type: 'turn' },
      log: [],
      sides: {
        a: { active: 0, out: mine.map((_, i) => i), squishies: mine, itemsUsed: [] },
        b: { active: 0, squishies: [{ ...squishy(boss, 9, 300, 300), boss: true }], itemsUsed: [] },
      },
    },
    speciesDefs: [],
    moveDefs: [],
    boss: {
      eventWindow: { id: '2026-11-14', endsAt: '2026-11-16T16:00:00.000Z' },
      triesLeftToday: 2,
      charmsPerAsk: 3,
      asksLeft: 2,
      befriend: 'none',
      baseName: 'Puddlet',
      warmth: 0,
    },
    ...over,
  } as unknown as PlayerBattle;
}

const won = (over: Partial<PlayerBattle> = {}) => {
  const b = battle(3, { status: 'finished', ...over });
  return {
    ...b,
    view: {
      ...b.view,
      phase: {
        type: 'over',
        result: { winner: 'a', reason: 'tuckered-out', contentHash: 'x', turns: 4, xp: [] },
      },
    },
  } as PlayerBattle;
};
const lost = (over: Partial<PlayerBattle> = {}, reason = 'tuckered-out') => {
  const b = won(over);
  return {
    ...b,
    view: { ...b.view, phase: { type: 'over', result: { ...b.view.phase, winner: 'b', reason } } },
  } as unknown as PlayerBattle;
};
const nameOf = (b: PlayerBattle) => (side: 'a' | 'b', slot: number) =>
  new BattleContent(b).speciesName(b.view.sides[side].squishies[slot]?.speciesId ?? '');

describe('a mini-boss fight on screen (#190)', () => {
  it('knows a team battle and its slots out', () => {
    const b = battle();
    expect(isTeamBattle(b)).toBe(true);
    expect(slotsOut(b, 'a')).toEqual([0, 1, 2]);
    expect(slotsOut(b, 'b')).toEqual([0]);
  });

  it.each([1, 2, 3])('shows four plates at most: a boss plate and %i friend plates', (team) => {
    const b = battle(team);
    const plates = bossPlates(b, shownFrom(b), new BattleContent(b), nameOf(b));
    expect(plates.friends).toHaveLength(team);
    expect(plates.boss).toMatchObject({ name: boss.name, percent: 100, energyText: '300/300' });
    expect(plates.friends.map((f) => f.slot)).toEqual([0, 1, 2].slice(0, team));
  });

  it('hides the "Stomps twice" chip while the shipped rule is one action a round (#234)', () => {
    const b = battle();
    const plates = bossPlates(b, shownFrom(b), new BattleContent(b), nameOf(b));
    expect(BATTLE_RULES.boss?.actionsPerRound).toBe(1);
    expect(plates.boss.stomps).toBe(false);
  });

  it('shows the "Stomps twice" chip only when the rule has the boss act more than once (#234)', () => {
    expect(stompsChip(1)).toBe(false);
    expect(stompsChip(2)).toBe(true);
    expect(stompsChip(3)).toBe(true);
    expect(stompsChip()).toBe(stompsChip(BATTLE_RULES.boss?.actionsPerRound ?? 1));
  });

  it('plates follow the energy shown, not the final view', () => {
    const b = battle();
    const shown = shownFrom(b);
    const half = { ...shown, a: { ...shown.a, energy: [20, 0, 40] } };
    const plates = bossPlates(b, half, new BattleContent(b), nameOf(b));
    expect(plates.friends.map((f) => [f.percent, f.down])).toEqual([
      [50, false],
      [0, true],
      [100, false],
    ]);
  });

  describe('picker A1', () => {
    it('steps through the standing squishies in slot order, then Ready', () => {
      const b = battle();
      let p = pickerFor(b, nameOf(b));
      expect(p.steps.map((s) => s.slot)).toEqual([0, 1, 2]);
      expect(teamAction(p)).toBeNull();
      p = pickMove(p, pip.moves[0]!);
      expect(p.at).toBe(1);
      p = pickMove(p, bun.moves[1]!);
      p = pickMove(p, moss.moves[0]!);
      expect(pickerReady(p)).toBe(true);
      expect(p.at).toBe(3);
      expect(teamAction(p)).toEqual({
        type: 'team',
        picks: [
          { slot: 0, move: pip.moves[0] },
          { slot: 1, move: bun.moves[1] },
          { slot: 2, move: moss.moves[0] },
        ],
      });
    });

    it('skips a tuckered-out squishy', () => {
      const b = battle(3, {}, [40, 0, 40]);
      expect(pickerFor(b, nameOf(b)).steps.map((s) => s.slot)).toEqual([0, 2]);
    });

    it('a tap on a finished chip goes back; the new pick replaces the old', () => {
      const b = battle();
      let p = pickerFor(b, nameOf(b));
      p = pickMove(pickMove(p, pip.moves[0]!), bun.moves[0]!);
      p = goTo(p, 0);
      expect(p.at).toBe(0);
      p = pickMove(p, pip.moves[1]!);
      // Back to the one still without a move.
      expect(p.at).toBe(2);
      expect(p.picks[0]).toBe(pip.moves[1]);
      expect(p.picks[1]).toBe(bun.moves[0]);
    });

    it('pickerFor offers only the pending move to a squishy winding up', () => {
      const b = battle();
      const pending = bun.moves[1]!;
      const winding: PlayerBattle = {
        ...b,
        view: {
          ...b.view,
          sides: {
            ...b.view.sides,
            a: {
              ...b.view.sides.a,
              squishies: b.view.sides.a.squishies.map((s, i) =>
                i === 1 ? { ...s, windup: { move: pending, target: 0 } } : s,
              ),
            },
          },
        },
      };
      let p = pickerFor(winding, nameOf(winding));
      expect(p.steps.map((s) => [s.slot, s.moves, s.windingUp === true])).toEqual([
        [0, pip.moves, false],
        [1, [pending], true],
        [2, moss.moves, false],
      ]);
      // Any other move is refused; the team pick still has one move per squishy.
      p = pickMove(p, pip.moves[0]!);
      expect(pickMove(p, bun.moves[0]!)).toBe(p);
      p = pickMove(pickMove(p, pending), moss.moves[0]!);
      expect(teamAction(p)).toEqual({
        type: 'team',
        picks: [
          { slot: 0, move: pip.moves[0] },
          { slot: 1, move: pending },
          { slot: 2, move: moss.moves[0] },
        ],
      });
    });

    it('refuses a move the squishy does not know', () => {
      const b = battle();
      const p = pickerFor(b, nameOf(b));
      expect(pickMove(p, 'not-a-move')).toBe(p);
    });

    it('"Same again" repeats last round for whoever still stands', () => {
      const b = battle(3, {}, [40, 0, 40]);
      const p = pickerFor(b, nameOf(b));
      const again = sameAgain(p, { 0: pip.moves[0]!, 1: bun.moves[0]!, 2: moss.moves[1]! })!;
      expect(again.picks).toEqual({ 0: pip.moves[0], 2: moss.moves[1] });
      expect(pickerReady(again)).toBe(true);
      expect(sameAgain(p, null)).toBeNull();
      expect(sameAgain(p, { 0: 'forgotten-move' })).toBeNull();
    });
  });

  it('calls out the boss stomping again, and an area move hitting everyone', () => {
    const area = GAME_DATA.moves.find((m) => isAreaMove(m));
    const plain = GAME_DATA.moves.find((m) => !isAreaMove(m))!;
    const moves = new Map(GAME_DATA.moves.map((m) => [m.id, m]));
    const step = (side: 'a' | 'b', move: string) => ({ kind: 'move', side, move });
    expect(bossCallout(step('b', plain.id), 'a', 0, moves)).toBeNull();
    expect(bossCallout(step('b', plain.id), 'a', 1, moves)).toBe(BOSS_TEXT.stompAgain);
    expect(bossCallout(step('a', plain.id), 'a', 1, moves)).toBeNull();
    if (area) expect(bossCallout(step('b', area.id), 'a', 0, moves)).toBe(BOSS_TEXT.everyone);
    // #234: a move an assist called in is not a second stomp, and a landing
    // windup keeps its own "Here it comes!".
    expect(bossCallout({ ...step('b', plain.id), backup: true }, 'a', 1, moves)).toBeNull();
    expect(bossCallout({ ...step('b', plain.id), landing: true }, 'a', 1, moves)).toBeNull();
    expect(isOwnMove({ kind: 'move', backup: true })).toBe(false);
    expect(isOwnMove({ kind: 'move' })).toBe(true);
    expect(isOwnMove({ kind: 'hit' })).toBe(false);
  });

  it('shows the boss winding up from the log played so far (#234)', () => {
    const b = battle();
    const shown = shownFrom(b);
    const names = new BattleContent(b);
    expect(bossPlates(b, shown, names, nameOf(b)).boss.windup).toBe(false);
    const chips = shown.b.chips.map((c) => ({ ...c, windup: true }));
    const winding = { ...shown, b: { ...shown.b, chips } };
    expect(bossPlates(b, winding, names, nameOf(b)).boss.windup).toBe(true);
    expect(isWindupMove({ effects: [{ type: 'windup' }] })).toBe(true);
    expect(isWindupMove({ effects: [] })).toBe(false);
  });

  it('names the bundle with plurals', () => {
    expect(bundleText({ 'heart-charm': 3, heartdust: 5, treats: 3 })).toBe(
      '3 Heart Charms, 5 Heartdust and 3 Treats',
    );
    expect(bundleText({ 'heart-charm': 1 })).toBe('1 Heart Charm');
  });

  it('says how long the visit stays, and its last day', () => {
    const b = battle();
    expect(hereUntil(b.boss!, NOW)).toMatch(/^here until \w+day$/);
    expect(lastDayOf(b.boss!, NOW)).toBe(false);
  });

  describe('the last day is the calendar day the visit ends on', () => {
    // A visit opening at 16:00 on Saturday in New York for 48 h ends at 16:00
    // Monday (21:00Z): Saturday, Sunday and Monday, three days of tries.
    const zone = 'America/New_York';
    const visit = { eventWindow: { id: '2026-11-14', endsAt: '2026-11-16T21:00:00.000Z' } };
    const at = (iso: string) => Date.parse(iso);

    it('not the day before, even under a day from the end (17:00 Sunday)', () => {
      const sunday5pm = at('2026-11-15T22:00:00.000Z');
      expect(lastDayOf(visit, sunday5pm, zone)).toBe(false);
      expect(hereUntil(visit, sunday5pm, zone)).toBe('here until Monday');
    });

    it("from the patch's midnight on the day it ends, and once it has ended", () => {
      expect(lastDayOf(visit, at('2026-11-16T04:59:00.000Z'), zone)).toBe(false);
      expect(lastDayOf(visit, at('2026-11-16T05:00:00.000Z'), zone)).toBe(true);
      expect(hereUntil(visit, at('2026-11-16T14:00:00.000Z'), zone)).toBe(BOSS_TEXT.lastDay);
      expect(lastDayOf(visit, at('2026-11-16T22:00:00.000Z'), zone)).toBe(true);
    });

    it("in the patch's zone, not the device's", () => {
      // 01:00Z Monday is still Sunday evening in New York: not the last day there.
      expect(lastDayOf(visit, at('2026-11-16T01:00:00.000Z'), zone)).toBe(false);
      expect(lastDayOf(visit, at('2026-11-16T01:00:00.000Z'), 'Europe/London')).toBe(true);
    });

    it('a visit ending at midnight belongs to the day before', () => {
      const midnight = { eventWindow: { id: '2026-11-14', endsAt: '2026-11-17T05:00:00.000Z' } };
      expect(lastDayOf(midnight, at('2026-11-16T14:00:00.000Z'), zone)).toBe(true);
      expect(hereUntil(midnight, at('2026-11-15T22:00:00.000Z'), zone)).toBe('here until Monday');
    });

    it('a kid out of tries at 17:00 the day before is told "back tomorrow"', () => {
      const out = { ...battle().boss!, ...visit, triesLeftToday: 0 };
      const card = bossResult(lost({ boss: out }), 'Rakelet', at('2026-11-15T22:00:00.000Z'), zone);
      expect(card).toMatchObject({ outcome: 'out', subtitle: 'Back tomorrow!' });
    });
  });

  describe('the result card', () => {
    it('a win names the bundle the server put in the bag', () => {
      const card = bossResult(
        won({ rewards: { bundle: { 'heart-charm': 3 } } as unknown as PlayerBattle['rewards'] }),
        'Rakelet',
        NOW,
      )!;
      expect(card.title).toBe(BOSS_TEXT.wonTitle);
      expect(card.subtitle).toBe('Rakelet sat down, puffing. It looks… friendly?');
      expect(card.lines).toEqual([BOSS_TEXT.bundle(bundleText({ 'heart-charm': 3 }))]);
    });

    it('a win folds the coins into the bundle line', () => {
      expect(wonLine({ 'heart-charm': 3 }, { patch: 5, heart: 2 })).toBe(
        'You won 3 Heart Charms, 5\u00a0Patch\u00a0Coins and 💛\u00a02!',
      );
      expect(wonLine(null, { patch: 1, heart: 0 })).toBe('You won 1\u00a0Patch\u00a0Coin!');
      expect(wonLine(null, { patch: 0, heart: 0 })).toBeNull();
      expect(wonLine({}, null)).toBeNull();
    });

    it('one XP line names the whole team', () => {
      const names: Record<string, string> = { a: 'Pip', b: 'Puff', c: 'Fizz' };
      const nameOf = (id: string) => names[id] ?? '?';
      const award = (squishyId: string, xp: number) => ({ squishyId, xp });
      expect(teamXpLine([award('a', 12), award('b', 12), award('c', 12)], nameOf)).toBe(
        'Pip, Puff and Fizz each earned 12 XP!',
      );
      expect(teamXpLine([award('a', 12), award('b', 9), award('c', 0)], nameOf)).toBe(
        'Pip got 12\u00a0XP and Puff got 9\u00a0XP!',
      );
      expect(teamXpLine([award('a', 7)], nameOf)).toBe('Pip earned 7 XP!');
      expect(teamXpLine([award('a', 0)], nameOf)).toBeNull();
    });

    it("leaves a benched teammate's cheer out of the team's line (#732)", () => {
      const names: Record<string, string> = { a: 'Pip', b: 'Puff', c: 'Fizz', d: 'Moss' };
      const nameOf = (id: string) => names[id] ?? '?';
      expect(
        teamXpLine(
          [
            { squishyId: 'a', xp: 12 },
            { squishyId: 'b', xp: 12 },
            { squishyId: 'd', xp: 4, bench: true },
          ],
          nameOf,
        ),
      ).toBe('Pip and Puff each earned 12 XP!');
      expect(teamXpLine([{ squishyId: 'd', xp: 4, bench: true }], nameOf)).toBeNull();
    });

    it('names each evolving meter and keeps an empty cell, in the XP line’s order', () => {
      const names: Record<string, string> = { a: 'Pip', b: 'Puff', c: 'Fizz', d: 'Moss' };
      const nameOf = (id: string) => names[id] ?? '?';
      const award = (squishyId: string, xp: number, meter: boolean, bench?: boolean) => ({
        squishyId,
        xp,
        evolvingBefore: meter ? 20 : null,
        evolvingAfter: meter ? 35 : null,
        ...(bench === undefined ? {} : { bench }),
      });
      expect(
        teamEvolvingRow(
          [
            award('a', 12, true),
            award('b', 9, false),
            award('x', 0, true),
            award('c', 9, true),
            award('d', 4, true, true),
          ],
          nameOf,
        ),
      ).toEqual([
        { name: 'Pip', before: 20, after: 35 },
        null,
        { name: 'Fizz', before: 20, after: 35 },
      ]);
      // No meters at all: no row.
      expect(teamEvolvingRow([award('a', 12, false), award('b', 9, false)], nameOf)).toEqual([]);
    });

    it('keeps a benched teammate’s own evolving meter under its cheer (#205)', () => {
      const names: Record<string, string> = { a: 'Pip', b: 'Puff', d: 'Moss' };
      const nameOf = (id: string) => names[id] ?? '?';
      const card = bossXp(
        [
          { squishyId: 'a', xp: 12, evolvingBefore: 20, evolvingAfter: 35 },
          // A fighter with no meter (none sent) keeps its empty cell.
          { squishyId: 'b', xp: 12, evolvingBefore: null, evolvingAfter: null },
          { squishyId: 'd', xp: 4, bench: true, evolvingBefore: 50, evolvingAfter: 58 },
        ],
        nameOf,
      );
      expect(card.xp).toEqual([
        'Pip and Puff each earned 12 XP!',
        REWARD_TEXT.cheeredXp('Moss', 4),
      ]);
      expect(card.bench).toEqual([false, true]);
      // The team's line has its meters in the row; the cheer keeps its own.
      expect(card.evolving).toEqual([null, { before: 50, after: 58 }]);
      expect(card.evolvingRow).toEqual([{ name: 'Pip', before: 20, after: 35 }, null]);
    });

    it('a benched cheer alone still shows its meter, with no team line', () => {
      const card = bossXp(
        [{ squishyId: 'd', xp: 4, bench: true, evolvingBefore: 50, evolvingAfter: 58 }],
        () => 'Moss',
      );
      expect(card.xp).toEqual([REWARD_TEXT.cheeredXp('Moss', 4)]);
      expect(card.bench).toEqual([true]);
      expect(card.evolving).toEqual([{ before: 50, after: 58 }]);
      expect(card.evolvingRow).toEqual([]);
      expect(bossXp([], () => '?').xp).toEqual([]);
    });

    it('a win by scoot or without a bundle has no bundle line', () => {
      expect(bossResult(won(), 'Rakelet', NOW)!.lines).toEqual([]);
    });

    it('a loss counts the tries left today', () => {
      const card = bossResult(lost(), 'Rakelet', NOW)!;
      expect(card).toMatchObject({ outcome: 'lost', title: 'So close! 💪' });
      expect(card.lines).toEqual(['🍀 2 tries left today']);
      const one = bossResult(lost({ boss: { ...battle().boss!, triesLeftToday: 1 } }), 'R', NOW)!;
      expect(one.lines).toEqual(['🍀 1 try left today']);
    });

    it('the last try says back tomorrow, but never on its last day', () => {
      const out = { ...battle().boss!, triesLeftToday: 0 };
      expect(bossResult(lost({ boss: out }), 'Rakelet', NOW)).toMatchObject({
        outcome: 'out',
        subtitle: 'Back tomorrow!',
      });
      const last = bossResult(
        lost({ boss: out }),
        'Rakelet',
        Date.parse('2026-11-16T10:00:00Z'),
        'Europe/London',
      )!;
      expect(last).toMatchObject({ outcome: 'last-day', subtitle: 'See you next time!' });
      expect(JSON.stringify(last)).not.toContain('tomorrow');
    });

    it('a scoot is left to the usual card (its words live in one place)', () => {
      expect(bossResult(lost({}, 'forfeit'), 'Rakelet', NOW)).toBeNull();
    });

    it('nothing while the fight is on', () => {
      expect(bossResult(battle(), 'Rakelet', NOW)).toBeNull();
    });
  });

  describe('the befriend moment', () => {
    const boss0 = battle().boss!;
    const view = (
      over: Partial<typeof boss0>,
      extra: { charms?: number | null; asksMade?: number } = {},
    ) =>
      befriendView({
        boss: { ...boss0, ...over },
        name: 'Rakelet',
        asksMade: extra.asksMade ?? 0,
        charms: extra.charms === undefined ? 7 : extra.charms,
      });

    it('nothing to ask while it is on or after a loss', () => {
      expect(view({ befriend: 'none' }).kind).toBe('none');
      expect(befriendView({ boss: undefined, name: 'x', asksMade: 0, charms: 1 }).kind).toBe(
        'none',
      );
    });

    it('offers the ask with three hearts, the charms and the asks left', () => {
      expect(view({ befriend: 'offer' })).toMatchObject({
        kind: 'ask',
        headline: 'Ask Rakelet to be your friend? 💗💗💗',
        notYet: null,
        charmsLine: '💗 You have 7 Heart Charms',
        asksLeft: 2,
        button: 'Give 3 Heart Charms 💗',
        enabled: true,
        needCharms: false,
        ask: 1,
      });
    });

    it('greys the ask out with too few charms and points home', () => {
      expect(view({ befriend: 'offer' }, { charms: 1 })).toMatchObject({
        button: 'You need 3 💗',
        enabled: false,
        needCharms: true,
        charmsLine: '💗 You have 1 Heart Charm',
      });
      expect(view({ befriend: 'offer' }, { charms: null })).toMatchObject({ enabled: false });
    });

    it('a "not yet" lights the server\'s warmth step in hearts, and asks again', () => {
      const v = view({ befriend: 'not-yet', asksLeft: 1, warmth: 1 }, { asksMade: 1 });
      expect(v).toMatchObject({
        kind: 'ask',
        notYet: 'Not yet! Rakelet likes you a little more now.',
        warmth: 1,
        button: 'Ask again (3 💗)',
        ask: 2,
      });
      expect(view({ befriend: 'not-yet', asksLeft: 1, warmth: 9 })).toMatchObject({ warmth: 4 });
      // Warmth carries across visits: the first ask of a later win shows it too.
      expect(view({ befriend: 'offer', warmth: 2 })).toMatchObject({ kind: 'ask', warmth: 2 });
      expect(WARMTH_HEARTS).toBe(5);
    });

    it('no asks left: it will be back next visit', () => {
      expect(view({ befriend: 'not-yet', asksLeft: 0, warmth: 2 })).toEqual({
        kind: 'closed',
        headline: 'Not yet! Rakelet likes you a little more now.',
        warmth: 2,
        line: "It'll be back next visit!",
      });
      // The day to ask ran out (#820: `offer` with no asks left).
      expect(view({ befriend: 'offer', asksLeft: 0 })).toMatchObject({
        kind: 'closed',
        headline: null,
      });
    });

    it('joined: the base form is the friend who hops over (#820)', () => {
      expect(view({ befriend: 'joined', asksLeft: 0 })).toMatchObject({
        kind: 'joined',
        headline: 'Puddlet joined your patch! 💗',
        sub: 'A little Puddlet hopped over to you.',
      });
    });

    it('a duplicate never joins: no ask, no charms', () => {
      const v = view({ befriend: 'have-one', asksLeft: 0 });
      expect(v).toEqual({
        kind: 'have-one',
        headline: 'You already have a Puddlet! 💗',
        sub: "It's so happy to see you again.",
      });
    });
  });

  it('every line follows the style guide', () => {
    const lines = Object.values(BOSS_TEXT).map((v) =>
      typeof v === 'function' ? (v as (...args: never[]) => string)(3 as never, 3 as never) : v,
    );
    for (const line of lines) expect(findAvoidedWords(line)).toEqual([]);
  });
});
