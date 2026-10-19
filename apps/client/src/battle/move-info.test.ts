import { findAvoidedWords, GAME_DATA, type Move } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { describeMove, moveEdge, moveLabel } from './move-info.js';

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
