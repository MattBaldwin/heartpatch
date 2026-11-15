import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FIXTURE_BATTLE_CONTENT,
  FIXTURE_POTIONS,
  ai,
  battleSetup,
  squishy,
} from '../../tests/fixtures/battle.js';
import {
  FIXTURE_TEAM_CONTENT as content,
  FIXTURE_TEAM_DATA,
  member,
  sturdy,
  teamSetup,
} from '../../tests/fixtures/team-battle.js';
import { Rng } from '../rng/index.js';
import {
  BattleChoiceSchema,
  BattleSetupSchema,
  ClientBattleViewSchema,
  type BattleChoice,
} from '../schemas/battle.js';
import { createBattleContent } from './content.js';
import {
  applyBattleAction,
  clientBattleView,
  legalChoices,
  replayBattle,
  sipOf,
  startBattle,
  teamPickOptions,
} from './engine.js';
import { outOf, type BattleEvent, type BattleState } from './state.js';

/** Every standing team member bonks the boss. */
function bonkAll(state: BattleState): Extract<BattleChoice, { type: 'team' }> {
  return {
    type: 'team',
    picks: teamPickOptions(state, 'a').map(({ slot }) => ({ slot, move: 'fixture-bonk' })),
  };
}

const turn = (state: BattleState, a: BattleChoice = bonkAll(state)) =>
  applyBattleAction(content, state, { type: 'turn', choices: { a } });

/** Who acted (a `move` or a `status-skip`) in `turn`, in order. */
const actors = (log: readonly BattleEvent[], turnNo: number) =>
  log.flatMap((e) =>
    e.turn === turnNo && (e.type === 'move' || e.type === 'status-skip')
      ? [`${e.side}${e.slot}`]
      : [],
  );

const fast = teamSetup('order', [
  member(0, 'fixture-bonkbun', { stats: sturdy(50) }),
  member(1, 'fixture-bonkbun', { stats: sturdy(70) }),
  member(2, 'fixture-bonkbun', { stats: sturdy(30) }),
]);

afterEach(() => vi.restoreAllMocks());

describe('starting a team battle (#190)', () => {
  it('puts the whole team out, joined, and scales the boss’s stats', () => {
    const state = startBattle(content, teamSetup('start', [member(0), member(1), member(2)]));
    expect(state.format).toEqual({ a: 3, b: 1 });
    expect(state.sides.a.out).toEqual([0, 1, 2]);
    expect(state.sides.b.out).toBeUndefined();
    expect(outOf(state, 'b')).toEqual([0]);
    expect(state.sides.a.squishies.every((s) => s.joined)).toBe(true);
    const plain = startBattle(content, teamSetup('start', [member(0)], { boss: undefined })).sides.b
      .squishies[0]!;
    const boss = state.sides.b.squishies[0]!;
    expect(boss.boss).toBe(true);
    expect(plain.boss).toBeUndefined();
    expect(boss.stats.hp).toBe(plain.stats.hp * 3);
    expect(boss.stats.defense).toBe(Math.floor((plain.stats.defense * 110) / 100));
    expect(boss.stats.attack).toBe(plain.stats.attack);
    expect(boss.energy).toBe(boss.stats.hp);
  });

  it('refuses setups that break the team rules', () => {
    const three = [member(0), member(1), member(2)];
    const bad = (setup: unknown) => () => startBattle(content, setup as never);
    expect(bad({ ...teamSetup('x', three), format: { a: 2, b: 1 } })).toThrow(/brings 3/);
    const playerBoss = teamSetup('x', three);
    expect(
      bad({
        ...playerBoss,
        sides: {
          ...playerBoss.sides,
          b: { ...playerBoss.sides.b, controller: { type: 'player' } },
        },
      }),
    ).toThrow(/AI-controlled/);
    expect(bad({ ...teamSetup('x', [member(0, 'fixture-bonkbun', { boss: true })]) })).toThrow(
      /only side b/,
    );
    const oldRules = { ...content.rules };
    delete oldRules.team;
    delete oldRules.boss;
    const old = createBattleContent(FIXTURE_TEAM_DATA, oldRules);
    expect(() => startBattle(old, teamSetup('x', three))).toThrow(/no team battles/);
  });

  it('keeps one-on-one setups and choices exactly as they parse today', () => {
    const setup = battleSetup(
      'old',
      { squishies: [squishy('fixture-emberbun')] },
      {
        controller: ai('wild'),
        squishies: [squishy('fixture-snoozlet')],
      },
    );
    expect(BattleSetupSchema.parse(setup)).toEqual(setup);
    const state = startBattle(FIXTURE_BATTLE_CONTENT, setup);
    expect(JSON.stringify(state)).not.toMatch(/"format"|"out"|"boss"/);
    const team: BattleChoice = {
      type: 'team',
      picks: [{ slot: 1, move: 'fixture-bonk', target: 0 }],
      item: { item: 'fixture-hearty-soup', slot: 1 },
    };
    expect(BattleChoiceSchema.parse(team)).toEqual(team);
    expect(sipOf(team)).toBe('fixture-hearty-soup');
    expect(() =>
      applyBattleAction(FIXTURE_BATTLE_CONTENT, state, { type: 'turn', choices: { a: team } }),
    ).toThrow(/only for a team battle/);
  });
});

describe('a team battle round (#190)', () => {
  it('moves everyone standing in speed order; the boss’s second action closes the round', () => {
    // Speeds: a1 70, boss ~, a0 50, a2 30.
    const state = startBattle(content, fast);
    const bossSpeed = state.sides.b.squishies[0]!.stats.speed;
    const next = turn(state);
    const order = [
      { who: 'a0', speed: 50 },
      { who: 'a1', speed: 70 },
      { who: 'a2', speed: 30 },
      { who: 'b0', speed: bossSpeed },
    ]
      .sort((x, y) => y.speed - x.speed)
      .map((m) => m.who);
    expect(actors(next.log, 1)).toEqual([...order, 'b0']);
    expect(next.phase.type).toBe('turn');
  });

  it('breaks speed ties with one seeded shuffle, drawn only when there is a tie', () => {
    const spy = vi.spyOn(Rng.prototype, 'int');
    // `chance` rolls int(1, 100); every other int here is a shuffle draw.
    const shuffles = () => spy.mock.calls.filter(([lo, hi]) => !(lo === 1 && hi === 100));
    turn(startBattle(content, fast));
    expect(shuffles()).toEqual([]);

    const boss = startBattle(content, fast).sides.b.squishies[0]!.stats.speed;
    const tied = teamSetup(
      'tied',
      [0, 1, 2].map((i) => member(i, 'fixture-bonkbun', { stats: sturdy(boss) })),
    );
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      spy.mockClear();
      const next = turn(startBattle(content, { ...tied, seed: `tied-${i}` }));
      // Fisher–Yates over four tied movers: three draws.
      expect(shuffles()).toHaveLength(3);
      seen.add(actors(next.log, 1).slice(0, 4).join(','));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('drops the pick of a squishy tuckered out before its turn', () => {
    let checked = 0;
    for (let i = 0; i < 40; i++) {
      const setup = teamSetup(`faint-${i}`, [
        member(0, 'fixture-bonkbun', { stats: { ...sturdy(10), hp: 3 } }),
        member(1, 'fixture-bonkbun', { stats: { ...sturdy(11), hp: 3 } }),
        member(2, 'fixture-bonkbun', { stats: sturdy(12) }),
      ]);
      const next = turn(startBattle(content, setup));
      for (const [at, out] of next.log.entries()) {
        if (out.type !== 'tuckered-out' || out.side !== 'a') continue;
        const later = next.log
          .slice(at)
          .filter((e) => e.type === 'move' && e.side === 'a' && e.slot === out.slot);
        expect(later).toEqual([]);
        checked += 1;
      }
      // `active` is the first standing slot.
      const standing = next.sides.a.squishies.findIndex((s) => s.energy > 0);
      if (standing >= 0) expect(next.sides.a.active).toBe(standing);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('never gives the boss more actions than foes standing', () => {
    for (const size of [1, 2, 3]) {
      let state = startBattle(
        content,
        teamSetup(
          `cap-${size}`,
          [0, 1, 2]
            .slice(0, size)
            .map((i) => member(i, 'fixture-bonkbun', { stats: sturdy(40 + i) })),
        ),
      );
      const before = state.turn + 1;
      state = turn(state);
      const bossActs = actors(state.log, before).filter((who) => who === 'b0');
      expect(bossActs).toHaveLength(Math.min(2, size));
    }
  });

  it('lets a dizzy or sleepy boss lose one action a round, then shake it off', () => {
    const state = startBattle(content, fast);
    const sleepy: BattleState = {
      ...state,
      sides: {
        ...state.sides,
        b: {
          ...state.sides.b,
          squishies: [{ ...state.sides.b.squishies[0]!, status: { id: 'sleepy', turnsLeft: 3 } }],
        },
      },
    };
    const next = turn(sleepy);
    const boss = next.log.filter(
      (e) => e.turn === 1 && 'slot' in e && e.side === 'b' && e.slot === 0,
    );
    expect(boss.map((e) => e.type).filter((t) => t !== 'hit' && t !== 'stance')).toEqual([
      'status-skip',
      'status-end',
      'move',
    ]);
    expect(next.sides.b.squishies[0]!.status).toBeNull();
  });

  it('refuses swaps, Heart Charms, missing picks and picks for nobody', () => {
    const state = startBattle(content, fast);
    expect(() => turn(state, { type: 'swap', slot: 1 })).toThrow(/takes a team choice/);
    expect(() => turn(state, { type: 'capture' })).toThrow(/takes a team choice/);
    expect(() => turn(state, { type: 'team', picks: [{ slot: 0, move: 'fixture-bonk' }] })).toThrow(
      /each squishy standing/,
    );
    expect(() =>
      turn(state, {
        type: 'team',
        picks: [
          { slot: 0, move: 'fixture-tickle-tackle' },
          { slot: 1, move: 'fixture-bonk' },
          { slot: 2, move: 'fixture-bonk' },
        ],
      }),
    ).toThrow(/doesn't know/);
    expect(() =>
      turn(state, {
        type: 'team',
        picks: [0, 1, 2].map((slot) => ({ slot, move: 'fixture-bonk', target: 3 })),
      }),
    ).toThrow(/can't aim/);
    const down = {
      ...state,
      sides: {
        ...state.sides,
        a: {
          ...state.sides.a,
          squishies: state.sides.a.squishies.map((s, i) => (i === 0 ? { ...s, energy: 0 } : s)),
        },
      },
    };
    expect(() =>
      turn(down, {
        type: 'team',
        picks: [0, 1, 2].map((slot) => ({ slot, move: 'fixture-bonk' })),
      }),
    ).toThrow(/nobody standing in slot 0/);
    expect(legalChoices(state, 'a')).toEqual([]);
    expect(teamPickOptions(down, 'a').map((o) => o.slot)).toEqual([1, 2]);
  });

  it('sips a potion with the squishy the choice names, before anyone moves', () => {
    const potions = createBattleContent(
      { ...FIXTURE_TEAM_DATA, resources: FIXTURE_POTIONS },
      content.rules,
    );
    const cocoa = potions.items.get('fixture-cozy-cocoa');
    const state = startBattle(potions, fast);
    const next = applyBattleAction(potions, state, {
      type: 'turn',
      choices: {
        a: { ...bonkAll(state), item: { item: 'fixture-cozy-cocoa', slot: 2 } },
      },
    });
    expect(next.log[0]).toMatchObject({
      type: 'item',
      side: 'a',
      slot: 2,
      item: 'fixture-cozy-cocoa',
    });
    expect(next.sides.a.squishies[2]!.boosts.defense).toBe(cocoa?.defensePercent);
    expect(next.sides.a.itemsUsed).toEqual(['fixture-cozy-cocoa']);
  });
});

describe('the end of a team battle (#190)', () => {
  it('pays battle XP to all three, and nothing to a side that runs away', () => {
    const { state } = (() => {
      let s = startBattle(
        content,
        teamSetup(
          'xp',
          [
            member(0, 'fixture-bonkbun', { level: 60 }),
            member(1, 'fixture-bonkbun', { level: 60 }),
            member(2, 'fixture-bonkbun', { level: 60 }),
          ],
          { level: 5 },
        ),
      );
      for (let i = 0; i < 50 && s.phase.type === 'turn'; i++) s = turn(s);
      return { state: s };
    })();
    expect(state.phase.type === 'over' && state.phase.result.winner).toBe('a');
    const xp = state.phase.type === 'over' ? state.phase.result.xp : [];
    expect(xp.filter((x) => x.side === 'a').map((x) => x.squishyId)).toEqual(['a:0', 'a:1', 'a:2']);
    expect(xp.filter((x) => x.side === 'a').every((x) => x.xp > 0)).toBe(true);

    const ran = applyBattleAction(content, turn(startBattle(content, fast)), {
      type: 'forfeit',
      side: 'a',
    });
    const paid = ran.phase.type === 'over' ? ran.phase.result.xp : [];
    expect(paid.filter((x) => x.side === 'a').map((x) => x.xp)).toEqual([0, 0, 0]);
  });

  it('replays the same bytes from the same seed and actions', () => {
    const actions = [];
    let state = startBattle(content, fast);
    for (let i = 0; i < 6 && state.phase.type === 'turn'; i++) {
      const action = { type: 'turn' as const, choices: { a: bonkAll(state) } };
      actions.push(action);
      state = applyBattleAction(content, state, action);
    }
    expect(JSON.stringify(replayBattle(content, fast, actions))).toBe(JSON.stringify(state));
  });

  it('shows clients the team on the field, never the RNG or the seed', () => {
    const state = turn(startBattle(content, fast));
    const view = clientBattleView(state);
    expect(view).not.toHaveProperty('rng');
    expect(JSON.stringify(view)).not.toMatch(/"rng"|"seed"/);
    expect(view.format).toEqual({ a: 3, b: 1 });
    expect(view.sides.a.out).toEqual([0, 1, 2]);
    expect(ClientBattleViewSchema.parse(JSON.parse(JSON.stringify(view)))).toEqual(view);
  });
});
