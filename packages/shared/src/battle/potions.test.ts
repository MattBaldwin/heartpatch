import { describe, expect, it } from 'vitest';
import {
  ai,
  battleSetup,
  deepFreeze,
  FIXTURE_BATTLE_DATA,
  FIXTURE_BATTLE_RULES,
  FIXTURE_POTION_CONTENT as content,
  FIXTURE_POTIONS as POTIONS,
  patchActive,
  squishy,
} from '../../tests/fixtures/battle.js';
import { Rng } from '../rng/index.js';
import {
  BattleChoiceSchema,
  ClientBattleViewSchema,
  PlayerBattleActionSchema,
  type BattleAction,
  type BattleChoice,
} from '../schemas/battle.js';
import { BattleRuleError, createBattleContent } from './content.js';
import {
  applyBattleAction,
  clientBattleView,
  legalChoices,
  replayBattle,
  sipOf,
  startBattle,
} from './engine.js';
import { effectiveStat, shieldedAmount } from './formulas.js';
import { activeSquishy, type BattleEvent, type BattleState } from './state.js';

/*
 * Battle potions (#214, owner decisions 2026-10-07): a boost or a heal, and
 * a shield that takes 75% off the next hit it takes. One of each per side
 * per battle. Since #403 (owner decision 2026-10-11) a potion is a free sip:
 * it rides along with a move, so the drinker still acts that turn. A bare
 * item choice (battles logged before #403) still takes the whole turn.
 */

const BREW = 'fixture-brave-brew';
const COCOA = 'fixture-cozy-cocoa';
const SOUP = 'fixture-hearty-soup';

const item = (id: string): BattleChoice => ({ type: 'item', item: id });
const move = (id: string): BattleChoice => ({ type: 'move', move: `fixture-${id}` });
/** A free sip (#403): drink `potion`, then use move `id`, in one turn. */
const sip = (potion: string, id: string): BattleChoice => ({
  type: 'move',
  move: `fixture-${id}`,
  item: potion,
});

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

  it('a bare item choice (pre-#403) takes the turn: no move, and the log records the item', () => {
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

describe('a free sip (#403): drink a potion and still move the same turn', () => {
  /** Twirlysprout (player, speed 45) against a faster Emberbun (speed 60); both moves land. */
  const faster = (seed = 'free-sip') =>
    deepFreeze(
      startBattle(
        content,
        battleSetup(
          seed,
          { squishies: [squishy('fixture-twirlysprout', { level: 20 })] },
          { squishies: [squishy('fixture-emberbun', { level: 20 })] },
        ),
      ),
    );
  const foeHit = (before: BattleState, after: BattleState) =>
    ofType(newEvents(before, after), 'hit').find((e) => e.side === 'b')!;
  const myHit = (before: BattleState, after: BattleState) =>
    ofType(newEvents(before, after), 'hit').find((e) => e.side === 'a')!;

  it('sips first, then still moves: the potion turn deals the player’s damage', () => {
    const state = faster();
    const next = turn(state, sip(COCOA, 'leafy-boop'), move('tickle-tackle'));
    const events = newEvents(state, next);
    expect(events[0]).toEqual({ turn: 1, side: 'a', slot: 0, type: 'item', item: COCOA });
    // The faster foe still goes first, into the shield; then the drinker's move lands.
    expect(ofType(events, 'move').map((e) => e.side)).toEqual(['b', 'a']);
    expect(myHit(state, next).shielded).toBe(true);
    const dealt = foeHit(state, next).amount;
    expect(dealt).toBeGreaterThan(0);
    expect(activeSquishy(next, 'b').energy).toBe(activeSquishy(state, 'b').energy - dealt);
    expect(next.sides.a.itemsUsed).toEqual([COCOA]);
  });

  it('deals exactly a plain move’s damage, and soaks the faster foe’s hit', () => {
    const state = faster();
    const plain = turn(state, move('leafy-boop'), move('tickle-tackle'));
    const sipped = turn(state, sip(COCOA, 'leafy-boop'), move('tickle-tackle'));
    // A sip never rolls, so the same rolls follow either way.
    expect(sipped.rng).toEqual(plain.rng);
    expect(foeHit(state, sipped).amount).toBe(foeHit(state, plain).amount);
    expect(myHit(state, sipped).amount).toBeLessThan(myHit(state, plain).amount);
  });

  it('Brave Brew’s boost counts for the drinker’s own move that turn', () => {
    const state = faster();
    const plain = turn(state, move('leafy-boop'), move('tickle-tackle'));
    const brave = turn(state, sip(BREW, 'leafy-boop'), move('tickle-tackle'));
    expect(foeHit(state, brave).amount).toBeGreaterThan(foeHit(state, plain).amount);
  });

  it('Hearty Soup heals before the foe’s move, then the drinker still moves', () => {
    const low = patchActive(faster(), 'a', { energy: 10 });
    const next = turn(low, sip(SOUP, 'leafy-boop'), move('tickle-tackle'));
    expect(newEvents(low, next).map((e) => e.type)).toEqual([
      'item',
      'heal',
      'move',
      'hit',
      'move',
      'hit',
    ]);
  });

  it('lets both sides sip in the same turn (live battles, #29)', () => {
    const state = faster();
    const next = turn(state, sip(BREW, 'leafy-boop'), sip(COCOA, 'tickle-tackle'));
    const events = newEvents(state, next);
    expect(events.slice(0, 2).map((e) => [e.type, e.side])).toEqual([
      ['item', 'a'],
      ['item', 'b'],
    ]);
    expect(ofType(events, 'move')).toHaveLength(2);
    expect(next.sides.b.itemsUsed).toEqual([COCOA]);
  });

  it('still allows one of each potion per battle, sipped or bare', () => {
    const once = turn(faster(), sip(BREW, 'leafy-boop'), move('tickle-tackle'));
    expect(() => turn(once, sip(BREW, 'leafy-boop'), move('tickle-tackle'))).toThrow(
      /already used/,
    );
    expect(() => turn(once, item(BREW), move('tickle-tackle'))).toThrow(/already used/);
    expect(turn(once, sip(COCOA, 'leafy-boop'), move('tickle-tackle')).sides.a.itemsUsed).toEqual([
      BREW,
      COCOA,
    ]);
  });

  it('refuses a sip of a non-potion, with an unknown move, or for an AI side', () => {
    const state = faster();
    expect(() => turn(state, sip('fixture-charm', 'leafy-boop'), move('tickle-tackle'))).toThrow(
      /can't be used in battle/,
    );
    expect(() => turn(state, sip(BREW, 'tickle-tackle'), move('tickle-tackle'))).toThrow(
      /doesn't know/,
    );
    expect(() => turn(duel(), sip(BREW, 'leafy-boop'), sip(BREW, 'giggle-drizzle'))).toThrow(
      /AI-controlled/,
    );
  });

  it('lists a sip with every move, and drops a potion once it’s used', () => {
    const state = faster();
    const moves = activeSquishy(state, 'a').moves;
    const choices = legalChoices(state, 'a', content);
    for (const potion of [BREW, COCOA, SOUP]) {
      for (const id of moves) {
        expect(choices).toContainEqual({ type: 'move', move: id, item: potion });
      }
    }
    const used = turn(state, sip(BREW, 'leafy-boop'), move('tickle-tackle'));
    expect(
      legalChoices(used, 'a', content).filter((c) => c.type === 'move' && c.item === BREW),
    ).toEqual([]);
    // No content, no items (the UI's moves and swaps only).
    expect(legalChoices(state, 'a').some((c) => sipOf(c) !== undefined)).toBe(false);
  });

  it('rides on a move only: a swap or a Heart Charm can’t carry one', () => {
    expect(BattleChoiceSchema.safeParse(sip(BREW, 'leafy-boop')).success).toBe(true);
    expect(BattleChoiceSchema.safeParse({ type: 'swap', slot: 1, item: BREW }).success).toBe(false);
    expect(BattleChoiceSchema.safeParse({ type: 'capture', item: BREW }).success).toBe(false);
    expect(
      PlayerBattleActionSchema.safeParse({ type: 'move', move: 'tickle-tackle', item: BREW })
        .success,
    ).toBe(true);
    expect(PlayerBattleActionSchema.safeParse({ type: 'swap', slot: 1, item: BREW }).success).toBe(
      false,
    );
  });

  it('sipOf reads a free sip and a bare one', () => {
    expect(sipOf(sip(BREW, 'leafy-boop'))).toBe(BREW);
    expect(sipOf(item(SOUP))).toBe(SOUP);
    expect(sipOf(move('leafy-boop'))).toBeUndefined();
    expect(sipOf(null)).toBeUndefined();
  });
});

function legalReplace(state: BattleState): number[] {
  return state.sides.a.squishies.flatMap((s, slot) =>
    slot !== state.sides.a.active && s.energy > 0 ? [slot] : [],
  );
}
