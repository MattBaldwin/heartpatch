import { describe, expect, it } from 'vitest';
import {
  ai,
  battleSetup,
  deepFreeze,
  FIXTURE_BATTLE_CONTENT as content,
  FIXTURE_BATTLE_DATA,
  patchActive,
  PLAYER,
  squishy,
  FIXTURE_BATTLE_RULES,
} from '../../tests/fixtures/battle.js';
import type {
  BattleAction,
  BattleChoice,
  BattleController,
  BattleSetup,
} from '../schemas/battle.js';
import { BattleRuleError, createBattleContent, type BattleContent } from './content.js';
import {
  applyBattleAction,
  battleRecord,
  clientBattleView,
  legalChoices,
  replayBattleRecord,
  startBattle,
} from './engine.js';
import type { BattleEvent, BattleState } from './state.js';

const move = (id: string): BattleChoice => ({ type: 'move', move: `fixture-${id}` });
const swap = (slot: number): BattleChoice => ({ type: 'swap', slot });

function turn(
  state: BattleState,
  a?: BattleChoice,
  b?: BattleChoice,
  c: BattleContent = content,
): BattleState {
  return applyBattleAction(c, state, { type: 'turn', choices: { a, b } });
}

/** Events added between two states. */
const newEvents = (before: BattleState, after: BattleState) => after.log.slice(before.log.length);
const ofType = <T extends BattleEvent['type']>(events: readonly BattleEvent[], type: T) =>
  events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);

const duel = (
  seed: string,
  a: string,
  b: string,
  extraA = {},
  extraB = {},
  c: BattleContent = content,
) =>
  startBattle(
    c,
    battleSetup(
      seed,
      { squishies: [squishy(`fixture-${a}`, extraA)] },
      { squishies: [squishy(`fixture-${b}`, extraB)] },
    ),
  );

describe('startBattle', () => {
  it('builds the first state from the setup and species data', () => {
    const state = startBattle(
      content,
      battleSetup(
        'start',
        {
          squishies: [
            squishy('fixture-emberbun'),
            squishy('fixture-puddlepuff', { feeling: 'brave', element: 'frost' }),
          ],
        },
        {
          controller: ai('wild'),
          squishies: [
            squishy('fixture-snoozlet', {
              stats: { hp: 99, attack: 9, defense: 9, speed: 9 },
            }),
          ],
        },
      ),
    );
    expect(state).toMatchObject({ version: 1, turn: 0, phase: { type: 'turn' }, log: [] });
    const [ember, puddle] = state.sides.a.squishies;
    expect(ember).toMatchObject({
      id: 'a:emberbun',
      element: 'fire',
      feeling: 'cozy',
      stats: { hp: 30, attack: 16, defense: 13, speed: 17 },
      energy: 30,
      stages: { attack: 0, defense: 0, speed: 0 },
      status: null,
      joined: true,
    });
    expect(puddle).toMatchObject({ element: 'frost', feeling: 'brave', joined: false });
    expect(state.sides.b.squishies[0]).toMatchObject({ energy: 99, stats: { hp: 99 } });
    expect(state.sides.b.controller).toEqual({ type: 'ai', policy: 'wild' });
  });

  it('rejects a team over the size limit', () => {
    const team = ['emberbun', 'snoozlet', 'puddlepuff', 'pebblesnooze'].map((s, i) =>
      squishy(`fixture-${s}`, { id: `s${i}` }),
    );
    expect(() =>
      startBattle(content, battleSetup('x', { squishies: team }, { squishies: [team[0]!] })),
    ).toThrow(/limit is 3/);
  });

  it('rejects unknown species and species with unknown moves', () => {
    expect(() => duel('x', 'nobody', 'snoozlet')).toThrow(BattleRuleError);
    const noLullaby = createBattleContent(
      {
        ...FIXTURE_BATTLE_DATA,
        moves: FIXTURE_BATTLE_DATA.moves.filter((m) => m.id !== 'fixture-lullaby'),
      },
      FIXTURE_BATTLE_RULES,
    );
    expect(() =>
      startBattle(
        noLullaby,
        battleSetup(
          'x',
          { squishies: [squishy('fixture-snoozlet')] },
          { squishies: [squishy('fixture-emberbun')] },
        ),
      ),
    ).toThrow(/unknown move "fixture-lullaby"/);
  });

  it('rejects setups that fail the schema', () => {
    const good = battleSetup(
      'x',
      { squishies: [squishy('fixture-snoozlet')] },
      { squishies: [squishy('fixture-emberbun')] },
    );
    const twice: BattleSetup = {
      ...good,
      sides: { ...good.sides, b: { ...good.sides.b, squishies: good.sides.a.squishies } },
    };
    expect(() => startBattle(content, twice)).toThrow(/in the battle twice/);
    expect(() => startBattle(content, { ...good, seed: '' })).toThrow();
    expect(() => duel('x', 'snoozlet', 'emberbun', { level: 0 })).toThrow();
  });
});

describe('turn order', () => {
  it('lets the faster squishy go first', () => {
    const state = duel('order', 'emberbun', 'twirlysprout');
    const after = turn(state, move('silly-face'), move('dizzy-dance'));
    expect(ofType(newEvents(state, after), 'move').map((e) => e.side)).toEqual(['a', 'b']);

    const slow = duel(
      'order',
      'emberbun',
      'twirlysprout',
      {},
      {
        stats: { hp: 50, attack: 10, defense: 10, speed: 99 },
      },
    );
    const flipped = turn(slow, move('silly-face'), move('dizzy-dance'));
    expect(ofType(newEvents(slow, flipped), 'move').map((e) => e.side)).toEqual(['b', 'a']);
  });

  it('breaks exact speed ties with a seeded coin flip', () => {
    const firsts = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const state = duel(`tie-${i}`, 'emberbun', 'emberbun');
      const after = turn(state, move('silly-face'), move('silly-face'));
      firsts.add(ofType(after.log, 'move')[0]!.side);
    }
    expect([...firsts].sort()).toEqual(['a', 'b']);
  });

  it('counts raised speed', () => {
    let state = duel('zoom', 'snoozlet', 'twirlysprout');
    state = turn(state, move('cuddle-nap'), move('silly-face'));
    expect(ofType(state.log, 'move')[0]!.side).toBe('b');
    state = patchActive(state, 'a', { stages: { attack: 0, defense: 0, speed: 2 } });
    const after = turn(state, move('cuddle-nap'), move('silly-face'));
    expect(ofType(newEvents(state, after), 'move')[0]!.side).toBe('a');
  });
});

describe('swapping', () => {
  const twoSquishies = () =>
    startBattle(
      content,
      battleSetup(
        'swap',
        { squishies: [squishy('fixture-emberbun'), squishy('fixture-puddlepuff')] },
        { squishies: [squishy('fixture-twirlysprout')] },
      ),
    );

  it('costs the turn, happens before moves, and the new squishy takes the move', () => {
    const state = twoSquishies();
    const after = turn(state, swap(1), move('leafy-boop'));
    const events = newEvents(state, after);
    expect(events.map((e) => e.type)).toEqual(['swap', 'move', 'hit']);
    expect(events[0]).toMatchObject({ side: 'a', slot: 0, to: 1 });
    expect(events[2]).toMatchObject({ side: 'a', slot: 1 });
    expect(after.sides.a.active).toBe(1);
    expect(after.sides.a.squishies[0]!.energy).toBe(30);
    expect(after.sides.a.squishies[1]!.joined).toBe(true);
  });

  it('resets stat stages and clears dizzy, but sleepy stays', () => {
    const dizzy = patchActive(twoSquishies(), 'a', {
      stages: { attack: 2, defense: -1, speed: 1 },
      status: { id: 'dizzy', turnsLeft: 3 },
    });
    const left = turn(dizzy, swap(1), move('silly-face')).sides.a.squishies[0]!;
    expect(left.stages).toEqual({ attack: 0, defense: 0, speed: 0 });
    expect(left.status).toBeNull();

    const sleepy = patchActive(twoSquishies(), 'a', { status: { id: 'sleepy', turnsLeft: 2 } });
    expect(turn(sleepy, swap(1), move('silly-face')).sides.a.squishies[0]!.status).toEqual({
      id: 'sleepy',
      turnsLeft: 2,
    });
  });
});

describe('move effects', () => {
  it('raises stats up to the cap and reports the change actually made', () => {
    let state = duel('stats', 'emberbun', 'snoozlet');
    for (let i = 0; i < 3; i++) state = turn(state, move('zippy-zoom'), move('cuddle-nap'));
    const changes = ofType(state.log, 'stat-change').filter((e) => e.side === 'a');
    expect(changes.map((e) => [e.stat, e.stages, e.total])).toEqual([
      ['speed', 2, 2],
      ['speed', 2, 4],
      ['speed', 0, 4],
    ]);
  });

  it("lowers the other squishy's stats", () => {
    const state = duel('stats', 'emberbun', 'snoozlet');
    const after = turn(state, move('silly-face'), move('cuddle-nap'));
    expect(after.sides.b.squishies[0]!.stages.attack).toBe(-1);
    expect(ofType(after.log, 'stat-change')[0]).toMatchObject({ side: 'b', stages: -1 });
  });

  it('heals up to full energy, and not past it', () => {
    const low = patchActive(duel('heal', 'emberbun', 'snoozlet'), 'a', { energy: 10 });
    const healed = turn(low, move('cuddle-nap'), move('cuddle-nap'));
    expect(healed.sides.a.squishies[0]!.energy).toBe(25);
    expect(ofType(healed.log, 'heal')).toEqual([
      { turn: 1, type: 'heal', side: 'a', slot: 0, amount: 15, energy: 25 },
    ]);
    const nearlyFull = patchActive(low, 'a', { energy: 28 });
    expect(
      turn(nearlyFull, move('cuddle-nap'), move('cuddle-nap')).sides.a.squishies[0]!.energy,
    ).toBe(30);
  });

  it('makes a squishy sleepy: it naps through its turns, then wakes and acts', () => {
    let state = duel('nap', 'twirlysprout', 'snoozlet');
    state = turn(state, move('lullaby'), move('cuddle-nap'));
    expect(ofType(state.log, 'status-start')).toEqual([
      { turn: 1, type: 'status-start', side: 'b', slot: 0, status: 'sleepy' },
    ]);
    const naps = state.sides.b.squishies[0]!.status!.turnsLeft + 1;

    // A second lullaby doesn't stack while it's still sleepy.
    const again = turn(state, move('lullaby'), move('cuddle-nap'));
    expect(ofType(newEvents(state, again), 'status-start')).toEqual([]);

    while (!ofType(state.log, 'move').some((e) => e.side === 'b')) {
      state = turn(state, move('silly-face'), move('cuddle-nap'));
    }
    expect(ofType(state.log, 'status-skip')).toHaveLength(naps);
    const types = state.log.filter((e) => 'side' in e && e.side === 'b').map((e) => e.type);
    expect(types.slice(-2)).toEqual(['status-end', 'move']);
    expect(state.sides.b.squishies[0]!.status).toBeNull();
  });

  it('makes a squishy dizzy: it sometimes wobbles and misses its turn', () => {
    const outcomes = new Set<string>();
    for (let i = 0; i < 60; i++) {
      let state = duel(`dizzy-${i}`, 'twirlysprout', 'emberbun');
      state = turn(state, move('dizzy-dance'), move('silly-face'));
      const after = turn(state, move('silly-face'), move('silly-face'));
      const b = newEvents(state, after).filter(
        (e) => 'side' in e && e.side === 'b' && e.type !== 'stat-change',
      );
      outcomes.add(b[0]!.type);
    }
    expect([...outcomes].sort()).toEqual(['move', 'status-skip']);
  });

  it('lets moves miss by their accuracy', () => {
    const results = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const state = duel(`miss-${i}`, 'pebblesnooze', 'pebblesnooze');
      const after = turn(state, move('rock-a-bye'), move('pebble-puff'));
      const a = newEvents(state, after).filter(
        (e) => e.type === 'miss' || e.type === 'status-start',
      );
      results.add(a.some((e) => e.type === 'miss' && e.side === 'a') ? 'miss' : 'landed');
    }
    expect([...results].sort()).toEqual(['landed', 'miss']);
  });

  it('tags hits with the effectiveness tier from data', () => {
    const state = duel('fx', 'emberbun', 'twirlysprout', {}, { level: 50 });
    const after = turn(state, move('tickle-tackle'), move('silly-face'));
    expect(ofType(after.log, 'hit')[0]).toMatchObject({ side: 'b', effectiveness: 'super' });
  });
});

describe('tuckered out, replacements and the end', () => {
  const lopsided = (bController: BattleController = PLAYER) =>
    startBattle(
      content,
      battleSetup(
        'end',
        {
          squishies: [squishy('fixture-emberbun', { level: 50 }), squishy('fixture-puddlepuff')],
        },
        {
          controller: bController,
          squishies: [
            squishy('fixture-twirlysprout', { level: 5 }),
            squishy('fixture-snoozlet', { level: 5 }),
          ],
        },
      ),
    );

  it('asks a player to send out the next squishy, without costing a turn', () => {
    const state = turn(lopsided(), move('tickle-tackle'), move('leafy-boop'));
    const events = state.log.map((e) => e.type);
    expect(events).toEqual(['move', 'hit', 'tuckered-out']);
    expect(state.phase).toEqual({ type: 'replace', sides: ['b'] });
    expect(state.turn).toBe(1);

    expect(() => turn(state, move('tickle-tackle'), move('leafy-boop'))).toThrow(
      /send someone out/,
    );
    expect(() =>
      applyBattleAction(content, state, { type: 'replace', side: 'a', slot: 1 }),
    ).toThrow(/nobody to replace/);
    expect(() =>
      applyBattleAction(content, state, { type: 'replace', side: 'b', slot: 0 }),
    ).toThrow(/can't send out slot 0/);

    const next = applyBattleAction(content, state, { type: 'replace', side: 'b', slot: 1 });
    expect(next.phase).toEqual({ type: 'turn' });
    expect(next.sides.b.active).toBe(1);
    expect(next.log.at(-1)).toEqual({ turn: 1, type: 'replace', side: 'b', slot: 1 });
  });

  it('sends out the next squishy for an AI side straight away', () => {
    const state = turn(lopsided(ai('guardian')), move('tickle-tackle'));
    expect(state.phase).toEqual({ type: 'turn' });
    expect(state.sides.b.active).toBe(1);
    expect(state.log.at(-1)).toMatchObject({ type: 'replace', side: 'b', slot: 1 });
  });

  it('ends when a whole side is tuckered out, with base XP for squishies that came out', () => {
    let state = turn(lopsided(), move('tickle-tackle'), move('leafy-boop'));
    state = applyBattleAction(content, state, { type: 'replace', side: 'b', slot: 1 });
    const before = state;
    state = turn(state, move('tickle-tackle'), move('lullaby'));

    // The slower squishy was tuckered out first, so it never got to move.
    expect(newEvents(before, state).map((e) => e.type)).toEqual([
      'move',
      'hit',
      'tuckered-out',
      'battle-end',
    ]);
    expect(state.phase).toEqual({
      type: 'over',
      result: {
        winner: 'a',
        reason: 'tuckered-out',
        contentHash: content.contentHash,
        turns: 2,
        xp: [
          // 4 XP × (5 + 5) opponent levels × 1.5 for the win. Puddlepuff never came out.
          { side: 'a', squishyId: 'a:emberbun', xp: 60 },
          // Nothing tuckered out on the other side: the minimum.
          { side: 'b', squishyId: 'b:twirlysprout', xp: 5 },
          { side: 'b', squishyId: 'b:snoozlet', xp: 5 },
        ],
      },
    });
    expect(() => turn(state, move('tickle-tackle'), move('lullaby'))).toThrow(/battle is over/);
  });

  it('lets a side forfeit (run away), in any phase but the end', () => {
    const state = lopsided();
    const ran = applyBattleAction(content, state, { type: 'forfeit', side: 'a' });
    expect(ran.phase).toMatchObject({
      type: 'over',
      result: { winner: 'b', reason: 'forfeit', turns: 0 },
    });
    expect(ran.log.map((e) => e.type)).toEqual(['forfeit', 'battle-end']);
    // Running away before a turn is played earns nobody XP: no free XP loop.
    expect(ran.phase).toMatchObject({
      result: {
        xp: [
          { squishyId: 'a:emberbun', xp: 0 },
          { squishyId: 'b:twirlysprout', xp: 0 },
        ],
      },
    });

    const waiting = turn(state, move('tickle-tackle'), move('leafy-boop'));
    const gaveUp = applyBattleAction(content, waiting, { type: 'forfeit', side: 'b' });
    expect(gaveUp.phase).toMatchObject({
      result: {
        winner: 'a',
        turns: 1,
        xp: [
          // 4 × level 5 tuckered out × 1.5 for the win.
          { squishyId: 'a:emberbun', xp: 30 },
          // The side that ran away earns nothing.
          { squishyId: 'b:twirlysprout', xp: 0 },
        ],
      },
    });
    expect(() => applyBattleAction(content, gaveUp, { type: 'forfeit', side: 'a' })).toThrow(
      BattleRuleError,
    );
  });

  it("doesn't let an AI side forfeit", () => {
    const state = lopsided(ai('wild'));
    expect(() => applyBattleAction(content, state, { type: 'forfeit', side: 'b' })).toThrow(
      /AI-controlled/,
    );
  });

  it('ends at the turn limit: more energy left wins, equal is a draw', () => {
    const short = createBattleContent(FIXTURE_BATTLE_DATA, {
      ...FIXTURE_BATTLE_RULES,
      maxTurns: 3,
    });
    let calm = duel('limit', 'snoozlet', 'snoozlet', {}, {}, short);
    for (let i = 0; i < 3; i++) calm = turn(calm, move('cuddle-nap'), move('cuddle-nap'), short);
    expect(calm.phase).toMatchObject({
      type: 'over',
      result: { winner: 'draw', reason: 'turn-limit', turns: 3 },
    });

    let close = duel('limit', 'emberbun', 'snoozlet', {}, { level: 50 }, short);
    for (let i = 0; i < 3; i++)
      close = turn(close, move('tickle-tackle'), move('cuddle-nap'), short);
    expect(close.phase).toMatchObject({ result: { winner: 'a', reason: 'turn-limit' } });
    let flipped = duel('limit', 'snoozlet', 'emberbun', { level: 50 }, {}, short);
    for (let i = 0; i < 3; i++)
      flipped = turn(flipped, move('cuddle-nap'), move('tickle-tackle'), short);
    expect(flipped.phase).toMatchObject({ result: { winner: 'b', reason: 'turn-limit' } });
  });
});

describe('choice checks', () => {
  const state = startBattle(
    content,
    battleSetup(
      'checks',
      { squishies: [squishy('fixture-emberbun'), squishy('fixture-snoozlet')] },
      { controller: ai('balanced'), squishies: [squishy('fixture-twirlysprout')] },
    ),
  );

  it.each<[string, BattleAction, RegExp]>([
    ['an unknown move', { type: 'turn', choices: { a: move('lullaby') } }, /doesn't know/],
    ['a swap to the active squishy', { type: 'turn', choices: { a: swap(0) } }, /slot 0/],
    ['a swap to an empty slot', { type: 'turn', choices: { a: swap(4) } }, /slot 4/],
    ['a missing player choice', { type: 'turn', choices: {} }, /needs a choice/],
    [
      'a choice for an AI side',
      { type: 'turn', choices: { a: move('cuddle-nap'), b: move('leafy-boop') } },
      /AI-controlled/,
    ],
    ['a replacement nobody needs', { type: 'replace', side: 'a', slot: 1 }, /nobody to replace/],
  ])('rejects %s', (_, action, message) => {
    expect(() => applyBattleAction(content, state, action)).toThrow(message);
  });

  it('rejects a swap to a tuckered-out squishy', () => {
    const tired = {
      ...state,
      sides: {
        ...state.sides,
        a: {
          ...state.sides.a,
          squishies: state.sides.a.squishies.map((s, i) => (i === 1 ? { ...s, energy: 0 } : s)),
        },
      },
    };
    expect(() => turn(tired, swap(1))).toThrow(/slot 1/);
    expect(legalChoices(tired, 'a')).toEqual([
      move('tickle-tackle'),
      move('cuddle-nap'),
      move('zippy-zoom'),
      move('silly-face'),
      { type: 'capture' },
    ]);
  });

  it('lists legal choices: known moves and healthy bench squishies, only on a turn', () => {
    expect(legalChoices(state, 'a')).toContainEqual(swap(1));
    expect(legalChoices(state, 'b')).toEqual([
      move('leafy-boop'),
      move('dizzy-dance'),
      move('lullaby'),
      move('silly-face'),
    ]);
    const over = applyBattleAction(content, state, { type: 'forfeit', side: 'a' });
    expect(legalChoices(over, 'a')).toEqual([]);
  });
});

describe('content hash and battle records', () => {
  it('stamps each battle with the content it was played with, and refuses other content', () => {
    const state = duel('hash', 'emberbun', 'twirlysprout');
    expect(state.contentHash).toMatch(/^[0-9a-f]{32}$/);
    expect(state.contentHash).toBe(content.contentHash);

    const retuned = createBattleContent(
      {
        ...FIXTURE_BATTLE_DATA,
        moves: FIXTURE_BATTLE_DATA.moves.map((m) =>
          m.id === 'fixture-tickle-tackle' ? { ...m, power: 80 } : m,
        ),
      },
      FIXTURE_BATTLE_RULES,
    );
    expect(retuned.contentHash).not.toBe(content.contentHash);
    expect(() => turn(state, move('silly-face'), move('silly-face'), retuned)).toThrow(
      /played with content/,
    );
  });

  it('ignores player-facing words and row order, but not rules', () => {
    const reworded = createBattleContent(
      {
        ...FIXTURE_BATTLE_DATA,
        species: [...FIXTURE_BATTLE_DATA.species].reverse(),
        moves: FIXTURE_BATTLE_DATA.moves.map((m) => ({ ...m, name: 'Boop', description: 'Boop!' })),
      },
      FIXTURE_BATTLE_RULES,
    );
    expect(reworded.contentHash).toBe(content.contentHash);
    const relined = createBattleContent(FIXTURE_BATTLE_DATA, {
      ...FIXTURE_BATTLE_RULES,
      effectiveness: FIXTURE_BATTLE_RULES.effectiveness.map((t) => ({ ...t, line: 'Wow!' })),
    });
    expect(relined.contentHash).toBe(content.contentHash);
    const longer = createBattleContent(FIXTURE_BATTLE_DATA, {
      ...FIXTURE_BATTLE_RULES,
      maxTurns: 60,
    });
    expect(longer.contentHash).not.toBe(content.contentHash);
  });

  it('builds a stored record with the result and resolved log, once the battle is over', () => {
    const setup = battleSetup(
      'record',
      { squishies: [squishy('fixture-emberbun', { level: 50 })] },
      { squishies: [squishy('fixture-twirlysprout', { level: 5 })] },
    );
    const actions: BattleAction[] = [
      { type: 'turn', choices: { a: move('tickle-tackle'), b: move('silly-face') } },
    ];
    const start = startBattle(content, setup);
    expect(() => battleRecord(setup, [], start)).toThrow(/not over/);
    const end = applyBattleAction(content, start, actions[0]!);
    const record = battleRecord(setup, actions, end);
    expect(record).toMatchObject({
      setup,
      actions,
      contentHash: content.contentHash,
      result: { winner: 'a', contentHash: content.contentHash },
    });
    expect(record.log).toBe(end.log);

    expect(replayBattleRecord(content, record)).toEqual(end);
    const retuned = createBattleContent(FIXTURE_BATTLE_DATA, {
      ...FIXTURE_BATTLE_RULES,
      maxTurns: 9,
    });
    expect(() => replayBattleRecord(retuned, record)).toThrow(/played with content/);
  });
});

describe('purity (tech spec §8)', () => {
  it('never changes its inputs and gives the same output for the same inputs', () => {
    const setup = deepFreeze(
      battleSetup(
        'pure',
        { squishies: [squishy('fixture-emberbun'), squishy('fixture-puddlepuff')] },
        { controller: ai('balanced'), squishies: [squishy('fixture-twirlysprout')] },
      ),
    );
    let state = deepFreeze(startBattle(content, setup));
    for (const choice of [
      move('silly-face'),
      swap(1),
      move('belly-flop'),
      move('giggle-drizzle'),
    ]) {
      const action = deepFreeze<BattleAction>({ type: 'turn', choices: { a: choice } });
      const snapshot = JSON.stringify(state);
      const next = applyBattleAction(content, state, action);
      expect(JSON.stringify(state)).toBe(snapshot);
      expect(applyBattleAction(content, state, action)).toEqual(next);
      expect(next).not.toBe(state);
      if (next.phase.type !== 'turn') break;
      state = deepFreeze(next);
    }
    expect(state.turn).toBeGreaterThan(0);
  });

  it('gives clients a view without the RNG state', () => {
    const state = duel('view', 'emberbun', 'twirlysprout');
    const view = clientBattleView(state);
    expect(view).not.toHaveProperty('rng');
    const { rng, ...rest } = state;
    expect(rng).toHaveLength(4);
    expect(view).toEqual(rest);
  });

  it('keeps state as plain JSON', () => {
    let state = duel('json', 'emberbun', 'twirlysprout');
    state = turn(state, move('zippy-zoom'), move('dizzy-dance'));
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

describe('capture (Heart Charms, #14)', () => {
  const capture: BattleChoice = { type: 'capture' };
  const wild = (seed: string, energy?: number) => {
    const state = startBattle(
      content,
      battleSetup(
        seed,
        { squishies: [squishy('fixture-emberbun')] },
        { controller: ai('wild'), squishies: [squishy('fixture-snoozlet')] },
      ),
    );
    return energy === undefined ? state : patchActive(state, 'b', { energy });
  };

  it('a sure capture always works and ends the battle, the thrower winning', () => {
    const state = wild('sure');
    const next = turn(state, { type: 'capture', sure: true });
    expect(newEvents(state, next)).toEqual([
      { turn: 1, side: 'b', slot: 0, type: 'capture', caught: true },
      { turn: 1, type: 'battle-end', winner: 'a', reason: 'captured' },
    ]);
    expect(next.phase.type === 'over' && next.phase.result.reason).toBe('captured');
  });

  it('rolls once with the battle RNG; a miss costs the turn and the wild squishy still moves', () => {
    let caught = 0;
    let missed = 0;
    for (let i = 0; i < 60; i++) {
      const state = wild(`roll-${String(i)}`);
      const next = turn(state, capture);
      const [event] = ofType(newEvents(state, next), 'capture');
      expect(event).toMatchObject({ side: 'b', slot: 0 });
      if (event?.caught) {
        caught += 1;
        expect(next.phase.type).toBe('over');
        expect(ofType(newEvents(state, next), 'move')).toEqual([]);
      } else {
        missed += 1;
        expect(next.phase.type).not.toBe('over');
        // The player's turn went on the charm; only the wild squishy moved.
        expect(ofType(newEvents(state, next), 'move').map((e) => e.side)).toEqual(['b']);
      }
      // Same state and action, same answer (replayable).
      expect(turn(state, capture)).toEqual(next);
    }
    // At full energy the chance is atFull (15%): mostly misses, some catches.
    expect(missed).toBeGreaterThan(caught);
    expect(caught).toBeGreaterThan(0);
  });

  it('works far more often when the wild squishy is nearly tuckered out', () => {
    let caught = 0;
    for (let i = 0; i < 60; i++) {
      const state = wild(`low-${String(i)}`, 1);
      if (ofType(newEvents(state, turn(state, capture)), 'capture')[0]?.caught) caught += 1;
    }
    expect(caught).toBeGreaterThan(40);
  });

  it("can't befriend another player's squishy, and AI sides can't be told to", () => {
    const pvp = startBattle(
      content,
      battleSetup(
        'pvp',
        { squishies: [squishy('fixture-emberbun')] },
        { squishies: [squishy('fixture-snoozlet')] },
      ),
    );
    expect(() => turn(pvp, capture, move('silly-face'))).toThrow(BattleRuleError);
    expect(legalChoices(pvp, 'a')).not.toContainEqual(capture);
    const state = wild('ai');
    expect(() => turn(state, move('tickle-tackle'), capture)).toThrow(/AI-controlled/);
  });

  it('gives the winning side its XP floor, like any win', () => {
    const state = wild('xp');
    const next = turn(state, { type: 'capture', sure: true });
    expect(next.phase.type === 'over' && next.phase.result.xp).toContainEqual({
      side: 'a',
      squishyId: 'a:emberbun',
      xp: content.rules.xp.minimum,
    });
  });
});
