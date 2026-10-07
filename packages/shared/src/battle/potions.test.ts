import { describe, expect, it } from 'vitest';
import {
  ai,
  battleSetup,
  deepFreeze,
  FIXTURE_BATTLE_DATA,
  FIXTURE_BATTLE_RULES,
  patchActive,
  squishy,
} from '../../tests/fixtures/battle.js';
import { Rng } from '../rng/index.js';
import { ClientBattleViewSchema, type BattleAction, type BattleChoice } from '../schemas/battle.js';
import type { Resource } from '../schemas/data/resources.js';
import { BattleRuleError, createBattleContent } from './content.js';
import {
  applyBattleAction,
  clientBattleView,
  legalChoices,
  replayBattle,
  startBattle,
} from './engine.js';
import { effectiveStat, shieldedAmount } from './formulas.js';
import { activeSquishy, type BattleEvent, type BattleState } from './state.js';

/*
 * Battle potions (#214, owner decisions 2026-10-07): a potion takes the
 * drinker's turn, gives a boost or a heal, and a shield that takes 75% off
 * the next hit it takes. One of each per side per battle.
 */

// Fixture potions with their own numbers (+25%), independent of the owner's
// tuning in data/resources.ts, so re-tuning never moves these tests.
const POTIONS: Resource[] = [
  {
    id: 'fixture-brave-brew',
    name: 'Brave Brew',
    description: 'Bolder.',
    kind: 'crafted',
    battleEffect: { attackPercent: 25, shieldPercent: 75 },
  },
  {
    id: 'fixture-cozy-cocoa',
    name: 'Cozy Cocoa',
    description: 'Softer bumps.',
    kind: 'crafted',
    battleEffect: { defensePercent: 25, shieldPercent: 75 },
  },
  {
    id: 'fixture-hearty-soup',
    name: 'Hearty Soup',
    description: 'Energy back.',
    kind: 'crafted',
    battleEffect: { healPercent: 40, shieldPercent: 75 },
  },
  { id: 'fixture-charm', name: 'Charm', description: 'Not a potion.', kind: 'crafted' },
];

const content = createBattleContent(
  { ...FIXTURE_BATTLE_DATA, resources: POTIONS },
  FIXTURE_BATTLE_RULES,
);

const BREW = 'fixture-brave-brew';
const COCOA = 'fixture-cozy-cocoa';
const SOUP = 'fixture-hearty-soup';

const item = (id: string): BattleChoice => ({ type: 'item', item: id });
const move = (id: string): BattleChoice => ({ type: 'move', move: `fixture-${id}` });

/** Twirlysprout (player) against a wild Puddlepuff; both moves always land. */
const duel = (seed = 'potions') =>
  deepFreeze(
    startBattle(
      content,
      battleSetup(
        seed,
        { squishies: [squishy('fixture-twirlysprout', { level: 20 })] },
        { controller: ai('wild'), squishies: [squishy('fixture-puddlepuff', { level: 20 })] },
      ),
    ),
  );

/** Two player sides, so each test picks both moves. */
const pvp = (seed = 'potions-pvp') =>
  deepFreeze(
    startBattle(
      content,
      battleSetup(
        seed,
        { squishies: [squishy('fixture-twirlysprout', { level: 20 })] },
        { squishies: [squishy('fixture-puddlepuff', { level: 20 })] },
      ),
    ),
  );

const turn = (state: BattleState, a?: BattleChoice, b?: BattleChoice) =>
  applyBattleAction(content, state, { type: 'turn', choices: { a, b } });

const newEvents = (before: BattleState, after: BattleState) => after.log.slice(before.log.length);
const ofType = <T extends BattleEvent['type']>(events: readonly BattleEvent[], type: T) =>
  events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);

describe('battle potions (#214)', () => {
  it('starts every squishy with no boosts or shield, and every side with nothing used', () => {
    const state = duel();
    for (const side of ['a', 'b'] as const) {
      expect(state.sides[side].itemsUsed).toEqual([]);
      expect(activeSquishy(state, side)).toMatchObject({
        boosts: { attack: 0, defense: 0 },
        shield: 0,
      });
    }
  });

  it('takes the turn: the drinker makes no move, and the log records the item', () => {
    const state = pvp();
    const next = turn(state, item(BREW), move('giggle-drizzle'));
    const events = newEvents(state, next);
    expect(events[0]).toEqual({ turn: 1, side: 'a', slot: 0, type: 'item', item: BREW });
    expect(ofType(events, 'move').map((e) => e.side)).toEqual(['b']);
    expect(next.sides.a.itemsUsed).toEqual([BREW]);
  });

  it('keeps a boost and a shield on the squishy that drank, through a swap out and back', () => {
    const team = deepFreeze(
      startBattle(
        content,
        battleSetup(
          'potion-swap',
          {
            squishies: [
              squishy('fixture-twirlysprout', { level: 20 }),
              squishy('fixture-emberbun', { level: 20 }),
            ],
          },
          { squishies: [squishy('fixture-pebblesnooze', { level: 20 })] },
        ),
      ),
    );
    // Rock-a-Bye lands no hit, so the shield stays up to be read.
    const drank = turn(team, item(BREW), move('rock-a-bye'));
    const out = turn(drank, { type: 'swap', slot: 1 }, move('rock-a-bye'));
    expect(activeSquishy(out, 'a').boosts).toEqual({ attack: 0, defense: 0 });
    const back = turn(out, { type: 'swap', slot: 0 }, move('rock-a-bye'));
    expect(activeSquishy(back, 'a')).toMatchObject({
      boosts: { attack: 25, defense: 0 },
      shield: 75,
    });
  });

  it('Brave Brew raises attack 25% for the rest of the battle', () => {
    const next = turn(pvp(), item(BREW), move('giggle-drizzle'));
    const me = activeSquishy(next, 'a');
    expect(me.boosts).toEqual({ attack: 25, defense: 0 });
    expect(effectiveStat(me, 'attack', content.rules)).toBe((me.stats.attack * 125) / 100);
    expect(effectiveStat(me, 'defense', content.rules)).toBe(me.stats.defense);
    expect(effectiveStat(me, 'speed', content.rules)).toBe(me.stats.speed);
  });

  it('Cozy Cocoa raises defense 25%, and stacks with stat stages', () => {
    const next = turn(pvp(), item(COCOA), move('giggle-drizzle'));
    const me = patchActive(next, 'a', { stages: { attack: 0, defense: 1, speed: 0 } });
    const staged = me.sides.a.squishies[0]!;
    expect(staged.boosts).toEqual({ attack: 0, defense: 25 });
    expect(effectiveStat(staged, 'defense', content.rules)).toBe(
      (staged.stats.defense * 1.5 * 125) / 100,
    );
  });

  it('Hearty Soup gives back 40% of full energy, never past full', () => {
    const state = pvp();
    const full = activeSquishy(state, 'a').stats.hp;
    const low = patchActive(state, 'a', { energy: 5 });
    const healed = turn(low, item(SOUP), move('giggle-drizzle'));
    const heal = ofType(newEvents(low, healed), 'heal')[0]!;
    expect(heal).toMatchObject({ side: 'a', amount: Math.floor((full * 40) / 100) });
    // At full energy it heals nothing (no heal event) but still shields.
    const topped = turn(state, item(SOUP), move('giggle-drizzle'));
    expect(ofType(newEvents(state, topped), 'heal')).toEqual([]);
    expect(ofType(newEvents(state, topped), 'hit')[0]).toMatchObject({ side: 'a', shielded: true });
  });

  it('the shield takes 75% off the next hit only, and the hit says so', () => {
    const state = pvp();
    const plain = patchActive(state, 'b', { shield: 0 });
    const shielded = patchActive(state, 'b', { shield: 75 });
    // The same rolls either way: only the shield differs.
    const hitOf = (s: BattleState) =>
      ofType(newEvents(s, turn(s, move('leafy-boop'), move('giggle-drizzle'))), 'hit').find(
        (e) => e.side === 'b',
      )!;
    const full = hitOf(plain);
    const soft = hitOf(shielded);
    expect(full.shielded).toBeUndefined();
    expect(soft.shielded).toBe(true);
    expect(soft.amount).toBe(Math.max(1, Math.floor((full.amount * 25) / 100)));
    expect(soft.amount).toBeLessThan(full.amount);

    // Used up by that hit: the next one lands in full.
    const after = turn(shielded, move('leafy-boop'), move('giggle-drizzle'));
    expect(activeSquishy(after, 'b').shield).toBe(0);
    const next = ofType(
      newEvents(after, turn(after, move('leafy-boop'), move('giggle-drizzle'))),
      'hit',
    ).find((e) => e.side === 'b')!;
    expect(next.shielded).toBeUndefined();
  });

  it('a potion’s shield is up for the hit in the same turn', () => {
    const state = pvp();
    const next = turn(state, item(COCOA), move('giggle-drizzle'));
    const hit = ofType(newEvents(state, next), 'hit')[0]!;
    expect(hit).toMatchObject({ side: 'a', shielded: true });
    expect(activeSquishy(next, 'a').shield).toBe(0);
  });

  it('a miss leaves the shield up for the next hit that lands', () => {
    // Belly Flop lands 90% of the time: find seeds where it misses (fixed, so deterministic).
    let misses = 0;
    for (let i = 0; i < 60 && misses < 3; i++) {
      const state = patchActive(pvp(`shield-miss-${String(i)}`), 'a', { shield: 75 });
      const next = turn(state, move('dizzy-dance'), move('belly-flop'));
      const events = newEvents(state, next);
      if (!ofType(events, 'miss').some((e) => e.side === 'b')) continue;
      misses += 1;
      expect(ofType(events, 'hit')).toEqual([]);
      expect(activeSquishy(next, 'a').shield).toBe(75);
    }
    expect(misses).toBeGreaterThan(0);
  });

  it('a move that lands no hit leaves the shield up', () => {
    const state = patchActive(pvp(), 'b', { shield: 75 });
    const next = turn(state, move('dizzy-dance'), move('giggle-drizzle'));
    expect(activeSquishy(next, 'b').shield).toBe(75);
  });

  it('a new shield replaces the old one rather than stacking', () => {
    const sleepy = startBattle(
      content,
      battleSetup(
        'replace-shield',
        { squishies: [squishy('fixture-twirlysprout', { level: 20 })] },
        { squishies: [squishy('fixture-pebblesnooze', { level: 20 })] },
      ),
    );
    const state = patchActive(sleepy, 'a', { shield: 40 });
    // Rock-a-Bye lands no hit, so the shield stays to be read.
    const next = turn(state, item(BREW), move('rock-a-bye'));
    expect(activeSquishy(next, 'a').shield).toBe(75);
  });

  it('the shield maths floors, keeps the minimum and never adds energy', () => {
    expect(shieldedAmount(20, 0, content.rules)).toBe(20);
    expect(shieldedAmount(20, 75, content.rules)).toBe(5);
    expect(shieldedAmount(19, 75, content.rules)).toBe(4);
    expect(shieldedAmount(3, 75, content.rules)).toBe(1);
    expect(shieldedAmount(1, 75, content.rules)).toBe(1);
    expect(shieldedAmount(0, 75, content.rules)).toBe(0);
  });

  it('allows one of each potion per side per battle', () => {
    const once = turn(pvp(), item(BREW), move('giggle-drizzle'));
    expect(() => turn(once, item(BREW), move('giggle-drizzle'))).toThrow(BattleRuleError);
    // A different potion is fine, and the other side has its own allowance.
    const twice = turn(once, item(COCOA), item(BREW));
    expect(twice.sides.a.itemsUsed).toEqual([BREW, COCOA]);
    expect(twice.sides.b.itemsUsed).toEqual([BREW]);
    expect(legalChoices(twice, 'a', content)).toContainEqual(item(SOUP));
    expect(legalChoices(twice, 'a', content)).not.toContainEqual(item(BREW));
    expect(legalChoices(twice, 'a', content)).not.toContainEqual(item(COCOA));
  });

  it('refuses things that aren’t battle items, and AI sides never get one', () => {
    const state = duel();
    expect(() => turn(state, item('fixture-charm'))).toThrow(BattleRuleError);
    expect(() => turn(state, item('fixture-nothing'))).toThrow(BattleRuleError);
    expect(() => turn(state, item(BREW), item(BREW))).toThrow(/AI-controlled/);
    expect(legalChoices(state, 'b', content).some((c) => c.type === 'item')).toBe(false);
    expect(legalChoices(state, 'a').some((c) => c.type === 'item')).toBe(false);
  });

  it('never changes the state it was given', () => {
    const state = duel();
    const next = turn(state, item(SOUP));
    expect(next).not.toBe(state);
    expect(state.sides.a.itemsUsed).toEqual([]);
  });

  it('replays exactly, potions included, and the view keeps them', () => {
    for (let game = 0; game < 20; game++) {
      const setup = battleSetup(
        `potion-replay-${String(game)}`,
        { squishies: [squishy('fixture-twirlysprout'), squishy('fixture-emberbun')] },
        { controller: ai('wild'), squishies: [squishy('fixture-splashmallow')] },
      );
      const player = Rng.fromSeed(`potion-player-${String(game)}`);
      const actions: BattleAction[] = [];
      let state = startBattle(content, setup);
      while (state.phase.type !== 'over') {
        const action: BattleAction =
          state.phase.type === 'replace'
            ? { type: 'replace', side: 'a', slot: player.pick(legalReplace(state)) }
            : { type: 'turn', choices: { a: player.pick(legalChoices(state, 'a', content)) } };
        actions.push(action);
        state = applyBattleAction(content, state, action);
      }
      expect(replayBattle(content, setup, actions)).toEqual(state);
      expect(ClientBattleViewSchema.parse(clientBattleView(state))).toEqual(
        clientBattleView(state),
      );
    }
  });

  it('reads a view stored before potions with nothing used and no shield', () => {
    const view = clientBattleView(duel());
    interface Loose {
      sides: Record<string, { itemsUsed?: unknown; squishies: Record<string, unknown>[] }>;
    }
    const old = JSON.parse(JSON.stringify(view)) as Loose;
    for (const side of Object.values(old.sides)) {
      delete side.itemsUsed;
      for (const s of side.squishies) {
        delete s['boosts'];
        delete s['shield'];
      }
    }
    expect(ClientBattleViewSchema.parse(old)).toEqual(view);
  });

  it('puts each potion’s numbers, not its words, in the content hash', () => {
    const tuned = createBattleContent(
      {
        ...FIXTURE_BATTLE_DATA,
        resources: POTIONS.map((r) =>
          r.id === BREW ? { ...r, battleEffect: { attackPercent: 30, shieldPercent: 75 } } : r,
        ),
      },
      FIXTURE_BATTLE_RULES,
    );
    expect(tuned.contentHash).not.toBe(content.contentHash);
    const reworded = createBattleContent(
      {
        ...FIXTURE_BATTLE_DATA,
        resources: POTIONS.map((r) => ({ ...r, name: `${r.name}!`, description: 'Yum.' })),
      },
      FIXTURE_BATTLE_RULES,
    );
    expect(reworded.contentHash).toBe(content.contentHash);
    const limited = createBattleContent(
      { ...FIXTURE_BATTLE_DATA, resources: POTIONS },
      { ...FIXTURE_BATTLE_RULES, items: { usesEach: 2 } },
    );
    expect(limited.contentHash).not.toBe(content.contentHash);
  });
});

function legalReplace(state: BattleState): number[] {
  return state.sides.a.squishies.flatMap((s, slot) =>
    slot !== state.sides.a.active && s.energy > 0 ? [slot] : [],
  );
}
