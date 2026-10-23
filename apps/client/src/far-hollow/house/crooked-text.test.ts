import { CROOKED_HOUSE, type CrookedThingKind } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { propNames } from './crooked-kit.js';
import {
  CROOKED_TEXT,
  elementWords,
  keyName,
  progressWords,
  roomWords,
  targetWords,
  thingAction,
} from './crooked-text.js';

describe('the Crooked House’s words (#306 6c)', () => {
  it('names the big button by how a thing is put right; a lift is a hold', () => {
    const kinds: CrookedThingKind[] = ['straighten', 'lift', 'rub', 'tap-rhythm', 'relight'];
    for (const k of kinds) expect(thingAction(k).label.length).toBeGreaterThan(0);
    expect(thingAction('lift').hold).toBe(true);
    expect(thingAction('straighten')).toEqual({ label: 'Straighten it 🖼️', hold: false });
  });

  it('says which key a locked door wants, never where it is', () => {
    const door = CROOKED_HOUSE.doors.find((d) => d.id === 'north-door')!;
    const at = { x: 0, z: 0 };
    const locked = targetWords({
      kind: 'door',
      door,
      state: { kind: 'locked', key: 'brass-key', held: false },
      at,
    });
    expect(locked.action).toBe(CROOKED_TEXT.tryDoor);
    expect(locked.bubble).toBe('Locked tight! The Brass Key is somewhere in this house…');
    const held = targetWords({
      kind: 'door',
      door,
      state: { kind: 'locked', key: 'brass-key', held: true },
      at,
    });
    expect(held.action).toBe('Use the Brass Key 🗝️');
    const sleeping = targetWords({
      kind: 'door',
      door,
      state: { kind: 'sleeping', power: 'fire', sleeper: 'the cold fireplace' },
      at,
    });
    expect(sleeping.bubble).toBe("The cold fireplace won't budge. A Fire friend could help 🔥");
    expect(keyName('attic-key')).toBe('Attic Key');
    expect(elementWords('water')).toEqual({ name: 'Water', icon: '💧' });
  });

  it('counts the keys and the rooms put right', () => {
    const words = progressWords({
      keys: ['brass-key'],
      rooms: [
        { id: 'front-hall', fixed: [], bloomed: true },
        { id: 'parlour', fixed: [], bloomed: true },
        { id: 'conservatory', fixed: [], bloomed: false },
      ],
    });
    expect(words.keys).toBe('1 of 6');
    expect(words.keysLabel).toBe('1 of 6 keys found');
    expect(words.rooms).toBe('2 of 3 put right');
    const parlour = CROOKED_HOUSE.rooms.find((r) => r.id === 'parlour')!;
    expect(roomWords(parlour, false)).toBe('Parlour 🕯️');
    expect(roomWords(parlour, true)).toBe('Parlour ✨');
  });

  it('draws every prop the house’s data names (a new one still draws, as a crate)', () => {
    const named = new Set(CROOKED_HOUSE.rooms.flatMap((r) => r.things.map((t) => t.prop)));
    const drawn = new Set(propNames());
    expect([...named].filter((p) => !drawn.has(p))).toEqual([]);
  });

  it('keeps the words kind and short', () => {
    const lines = [
      ...Object.values(CROOKED_TEXT).flatMap((w) => (typeof w === 'string' ? [w] : [])),
      CROOKED_TEXT.locked('Brass Key'),
      CROOKED_TEXT.bloomTitle('Sewing Room'),
      CROOKED_TEXT.keyLine('the sewing basket'),
      CROOKED_TEXT.sleeping('the dark closet', 'Light', '✨'),
    ];
    for (const line of lines) {
      expect(line).not.toMatch(/village|community|scary|dead|kill|hurt/i);
      expect(line.length).toBeLessThan(90);
    }
  });
});
