import { findAvoidedWords, GAME_DATA, type PlayerBattle } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { shownFrom } from './battle-playback.js';
import { BattleContent } from './battle-view.js';
import {
  BOSS_TEXT,
  befriendView,
  bossCallout,
  bossPlates,
  bossResult,
  bundleText,
  goTo,
  hereUntil,
  isAreaMove,
  isTeamBattle,
  lastDayOf,
  pickerFor,
  pickerReady,
  pickMove,
  sameAgain,
  slotsOut,
  teamAction,
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
  });

  it('says how long the visit stays, and its last day', () => {
    const b = battle();
    expect(hereUntil(b.boss!, NOW)).toMatch(/^here until \w+day$/);
    expect(lastDayOf(b.boss!, NOW)).toBe(false);
    expect(hereUntil(b.boss!, Date.parse('2026-11-16T00:00:00.000Z'))).toBe(BOSS_TEXT.lastDay);
  });

  describe('the result card', () => {
    it('a win names the bundle the server put in the bag', () => {
      const card = bossResult(
        won({ rewards: { bundle: { 'heart-charm': 3 } } as PlayerBattle['rewards'] }),
        'Rakelet',
        NOW,
      )!;
      expect(card.title).toBe(BOSS_TEXT.wonTitle);
      expect(card.subtitle).toBe('Rakelet sat down, puffing. It looks… friendly?');
      expect(card.lines).toEqual([BOSS_TEXT.bundle(bundleText({ 'heart-charm': 3 }))]);
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
      const last = bossResult(lost({ boss: out }), 'Rakelet', Date.parse('2026-11-16T01:00:00Z'))!;
      expect(last).toMatchObject({ outcome: 'last-day', subtitle: 'See you next time!' });
      expect(JSON.stringify(last)).not.toContain('tomorrow');
    });

    it('a scoot keeps the usual words', () => {
      expect(bossResult(lost({}, 'forfeit'), 'Rakelet', NOW)?.outcome).toBe('scooted');
    });

    it('nothing while the fight is on', () => {
      expect(bossResult(battle(), 'Rakelet', NOW)).toBeNull();
    });
  });

  describe('the befriend moment', () => {
    const boss0 = battle().boss!;
    const view = (
      over: Partial<typeof boss0>,
      extra: { charms?: number | null; misses?: number; asksMade?: number } = {},
    ) =>
      befriendView({
        boss: { ...boss0, ...over },
        name: 'Rakelet',
        asksMade: extra.asksMade ?? 0,
        misses: extra.misses ?? 0,
        charms: extra.charms === undefined ? 7 : extra.charms,
      });

    it('nothing to ask while it is on or after a loss', () => {
      expect(view({ befriend: 'none' }).kind).toBe('none');
      expect(
        befriendView({ boss: undefined, name: 'x', asksMade: 0, misses: 0, charms: 1 }).kind,
      ).toBe('none');
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
        ask: 1,
      });
    });

    it('greys the ask out with too few charms and points home', () => {
      expect(view({ befriend: 'offer' }, { charms: 1 })).toMatchObject({
        button: 'You need 3 💗',
        enabled: false,
        needHint: 'Heart Charms are made at home.',
        charmsLine: '💗 You have 1 Heart Charm',
      });
      expect(view({ befriend: 'offer' }, { charms: null })).toMatchObject({ enabled: false });
    });

    it('a "not yet" lights one heart per miss, never a number, and asks again', () => {
      const v = view({ befriend: 'not-yet', asksLeft: 1 }, { misses: 1, asksMade: 1 });
      expect(v).toMatchObject({
        kind: 'ask',
        notYet: 'Not yet! Rakelet likes you a little more now.',
        warmth: 1,
        button: 'Ask again (3 💗)',
        ask: 2,
      });
      expect(view({ befriend: 'not-yet', asksLeft: 1 }, { misses: 9 })).toMatchObject({
        warmth: 4,
      });
    });

    it('no asks left: it will be back next visit', () => {
      expect(view({ befriend: 'not-yet', asksLeft: 0 }, { misses: 2 })).toEqual({
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

    it('joined', () => {
      expect(view({ befriend: 'joined', asksLeft: 0 })).toMatchObject({
        kind: 'joined',
        headline: 'Rakelet joined your patch! 💗',
      });
    });

    it('a duplicate never joins: no ask, no charms', () => {
      const v = view({ befriend: 'have-one', asksLeft: 0 });
      expect(v).toEqual({
        kind: 'have-one',
        headline: 'You already have a Rakelet! 💗',
        sub: "It's so happy to see you again.",
      });
    });
  });

  it('every line follows the style guide', () => {
    const lines = Object.values(BOSS_TEXT).map((v) =>
      typeof v === 'function' ? v(3 as never) : v,
    );
    for (const line of lines) expect(findAvoidedWords(String(line))).toEqual([]);
  });
});
