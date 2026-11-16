import {
  BATTLE_RULES,
  findAvoidedWords,
  GAME_DATA,
  speciesMoveKinds,
  type Move,
  type MoveEffect,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  describeMove,
  type MoveContext,
  GENTLE_HINT,
  gentleHintShows,
  lockForWindup,
  WINDUP_HINT,
  moveEdge,
  moveLabel,
  STYLE_MORE,
} from './move-info.js';

const me = { feeling: 'cozy' } as const;
const plain = { element: 'light', feeling: 'cozy' } as const;
const move = (id: string): Move => {
  const found = GAME_DATA.moves.find((m) => m.id === id);
  if (!found) throw new Error(`no move ${id}`);
  return found;
};

describe('describeMove', () => {
  it('calls a move with power a boop and shows its power', () => {
    const info = describeMove(move('ember-boop'), me, plain);
    expect(info).toMatchObject({ kind: 'boop', number: '40', line: 'Takes their energy' });
  });

  it('reads a heal, a shield and a sleepy move from their effects', () => {
    expect(describeMove(move('cozy-crackle'), me, plain)).toMatchObject({
      kind: 'heal',
      line: 'Heals you 35%',
      number: null,
    });
    expect(describeMove(move('sturdy-sit'), me, plain)).toMatchObject({
      kind: 'shield',
      line: 'Your snuggliness goes way up',
    });
    expect(describeMove(move('rock-a-bye'), me, plain)).toMatchObject({
      kind: 'status',
      look: { label: 'Sleepy' },
      line: 'Might make them sleepy',
    });
  });

  it('puts the weaken, boost and shield kinds on their stat effects', () => {
    const kinds = new Set(GAME_DATA.moves.map((m) => describeMove(m, me, plain).kind));
    expect([...kinds].sort()).toEqual(['boop', 'boost', 'heal', 'shield', 'status', 'weaken']);
  });

  it('does not repeat the button line in the details', () => {
    for (const m of GAME_DATA.moves) {
      const { line, more } = describeMove(m, me, plain);
      expect(more).not.toContain(`${line}.`);
      expect(more[0]).toBe(m.description);
    }
  });

  it('gives every move in the game a line and no avoided words', () => {
    for (const m of GAME_DATA.moves) {
      const info = describeMove(m, me, plain);
      expect(info.line, m.id).not.toBe('');
      const text = [info.line, info.look.label, ...info.more.slice(1)].join(' ');
      expect(findAvoidedWords(text), `${m.id}: ${text}`).toEqual([]);
    }
  });

  it('labels the whole button for a screen reader', () => {
    const info = describeMove(move('ember-boop'), me, plain);
    expect(moveLabel('Ember Boop', info)).toBe('Ember Boop. Boop. Takes their energy. Power 40');
  });
});

describe('lockForWindup (#234)', () => {
  const info = describeMove(move('ember-boop'), me, plain);
  const buttons = [
    { id: 'a', name: 'A', info },
    { id: 'b', name: 'B', info },
  ];

  it('locks every move but the pending one, which says to keep winding up', () => {
    expect(lockForWindup(buttons, 'b')).toEqual([
      { id: 'a', name: 'A', info, locked: true },
      { id: 'b', name: 'B', info: { ...info, hint: WINDUP_HINT } },
    ]);
    expect(WINDUP_HINT).toBe('Keep winding up!');
  });

  it('leaves the buttons alone when nothing is winding up', () => {
    expect(lockForWindup(buttons, null)).toEqual(buttons);
  });
});

describe('the #234 effect sentences', () => {
  const withEffect = (effect: MoveEffect, context: MoveContext = {}): string[] =>
    describeMove({ ...move('ember-boop'), effects: [effect] }, me, plain, context).more.slice(2);

  it('describes the four new effects in plain words', () => {
    expect(withEffect({ type: 'windup' })).toEqual([
      'Takes a round to wind up, then hits next round.',
    ]);
    expect(withEffect({ type: 'flinch', chance: 100 })).toEqual([
      'They might flinch and skip their move this round.',
    ]);
    expect(withEffect({ type: 'flinch', chance: 30 })).toEqual([
      'They might flinch and skip their move this round (30% chance).',
    ]);
    expect(withEffect({ type: 'low-energy', extraPercent: 50 })).toEqual([
      'Hits harder the lower your energy: up to 50% harder.',
    ]);
    // The called-in move's name, from the battle's move defs; none known yet: a friend.
    expect(withEffect({ type: 'assist', move: 'ember-boop' })).toEqual([
      'Calls in a friend to help!',
    ]);
    const moveName = (id: string) => (id === 'mama-bear-charge' ? 'Mama Bear Charge' : undefined);
    expect(withEffect({ type: 'assist', move: 'mama-bear-charge' }, { moveName })).toEqual([
      "Calls in a friend's Mama Bear Charge!",
    ]);
    expect(withEffect({ type: 'assist', move: 'nope' }, { moveName })).toEqual([
      'Calls in a friend to help!',
    ]);
  });

  it('uses no avoided words', () => {
    const effects: MoveEffect[] = [
      { type: 'windup' },
      { type: 'flinch', chance: 100 },
      { type: 'flinch', chance: 30 },
      { type: 'low-energy', extraPercent: 50 },
      { type: 'assist', move: 'ember-boop' },
    ];
    for (const effect of effects) {
      const text = withEffect(effect).join(' ');
      expect(findAvoidedWords(text), text).toEqual([]);
    }
  });
});

describe('moveEdge', () => {
  it('marks a boop strong into a weakness and weak into a resistance', () => {
    const frost = { element: 'frost', feeling: 'cozy' } as const;
    const water = { element: 'water', feeling: 'cozy' } as const;
    expect(moveEdge(move('ember-boop'), me, frost)).toBe('strong');
    expect(moveEdge(move('ember-boop'), me, water)).toBe('weak');
  });

  it('says nothing for a plain matchup or a move without power', () => {
    expect(moveEdge(move('ember-boop'), me, plain)).toBeNull();
    expect(moveEdge(move('cozy-crackle'), me, { element: 'frost', feeling: 'cozy' })).toBeNull();
  });

  it('leaves the feeling table out for a fence, so only its element counts', () => {
    // Fire into frost is a strength; a fence's feeling must not blunt it.
    const brave = { feeling: 'brave' } as const;
    const calm = { element: 'frost', feeling: 'cozy' } as const;
    const flipped = GAME_DATA.feelingMatrix.brave.cozy;
    expect(flipped).not.toBe(1);
    expect(moveEdge(move('ember-boop'), brave, { ...calm, fence: 'leaf-fence' })).toBe('strong');
  });
});

describe('Steady and Big moves (#587)', () => {
  const moves = new Map(GAME_DATA.moves.map((m) => [m.id, m]));
  const flurrypup = GAME_DATA.species.find((s) => s.id === 'flurrypup')!;
  const styles = speciesMoveKinds(flurrypup, moves, BATTLE_RULES.moveKinds!);
  // The owner's screenshot: Flurrypup Lv13 vs a wild Thistlepip Lv5 at 4/20, 5 Heart Charms.
  const thistlepip = {
    element: 'leaf',
    feeling: 'silly',
    energy: 4,
    stats: { hp: 20, attack: 9, defense: 9, speed: 9 },
  } as const;

  it('tells Snowball Toss and Frosty Pounce apart', () => {
    const snowball = describeMove(move('snowball-toss'), me, thistlepip, {
      style: styles.get('snowball-toss'),
      gentleHint: gentleHintShows({ gentle: true }, thistlepip, 5),
    });
    const pounce = describeMove(move('frosty-pounce'), me, thistlepip, {
      style: styles.get('frosty-pounce'),
      gentleHint: true,
    });
    expect(snowball).toMatchObject({
      style: 'steady',
      look: { icon: '🛡️', label: 'Steady' },
      line: 'Lighter, raises your guard',
      number: '45',
      hits: null,
      hint: GENTLE_HINT,
    });
    // A big move never wears the gentle hint, and says it can miss.
    expect(pounce).toMatchObject({
      style: 'big',
      look: { icon: '💥', label: 'Big' },
      line: 'Hits hard, leaves you open',
      number: '75',
      hits: '90% hits',
      hint: null,
    });
    expect(moveLabel('Snowball Toss', snowball)).toContain(GENTLE_HINT);
    // The ⓘ view explains what each kind means (owner follow-up).
    expect(snowball.more).toContain(STYLE_MORE.steady);
    expect(pounce.more).toContain(STYLE_MORE.big);
    for (const info of [snowball, pounce]) {
      for (const text of [info.line, info.hint ?? '', ...info.more]) {
        expect(findAvoidedWords(text)).toEqual([]);
      }
    }
  });

  it('shows the gentle hint only in a gentle battle, below half energy, with a Heart Charm', () => {
    expect(gentleHintShows({ gentle: true }, thistlepip, 5)).toBe(true);
    expect(gentleHintShows({}, thistlepip, 5)).toBe(false);
    expect(gentleHintShows({ gentle: true }, thistlepip, 0)).toBe(false);
    expect(gentleHintShows({ gentle: true }, thistlepip, null)).toBe(false);
    expect(gentleHintShows({ gentle: true }, { ...thistlepip, energy: 10 }, 5)).toBe(false);
    expect(gentleHintShows({ gentle: true }, { ...thistlepip, fence: 'hedge' }, 5)).toBe(false);
  });

  it('leaves moves with no style as they were', () => {
    expect(describeMove(move('ember-boop'), me, plain)).toMatchObject({
      style: null,
      look: { label: 'Boop' },
      line: 'Takes their energy',
    });
  });
});
