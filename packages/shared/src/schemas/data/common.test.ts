import { describe, expect, it } from 'vitest';
import { HexColorSchema } from './common.js';
import { CrookedRoomSchema } from './crooked-house.js';
import { PartSchema, type Part } from './visuals.js';

/**
 * One `HexColorSchema` (#234 follow-up): the species palette, the part accent
 * and the crooked rooms' colours all read it, and each accepts exactly what
 * its old inline regex (`/^#[0-9a-f]{6}$/`) did.
 */
const GOOD = ['#000000', '#ffaa00', '#b4bdc8', '#0f0f0f'];
const BAD = [
  '#FFAA00',
  '#Ffaa00',
  'ffaa00',
  '#fa0',
  '#ffaa0',
  '#ffaa000',
  '#ggaa00',
  ' #ffaa00',
  '#ffaa00 ',
  'grey',
  '',
  '#ffaa00\n',
];
const OLD_INLINE = /^#[0-9a-f]{6}$/;

describe('HexColorSchema', () => {
  it('accepts exactly what the old inline regex did', () => {
    for (const color of [...GOOD, ...BAD]) {
      expect(HexColorSchema.safeParse(color).success, JSON.stringify(color)).toBe(
        OLD_INLINE.test(color),
      );
    }
  });

  it('refuses a non-string and names the shape it wants', () => {
    expect(HexColorSchema.safeParse(0xffaa00).success).toBe(false);
    const result = HexColorSchema.safeParse('#FFAA00');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Expected a colour like "#ffaa00"');
  });

  it('is the rule for a part accent colour', () => {
    const tine: Part = {
      id: 'test-tine',
      slot: 'fangs',
      shape: 'bent',
      size: [0.07, 0.25, 0.1],
      color: 'metal',
      layout: { kind: 'ring', count: 4, spread: 86 },
      around: 0,
      up: -15,
      jitter: 0,
      accent: { mesh: 'bent-toe', color: '#b4bdc8' },
    };
    for (const color of [...GOOD, ...BAD]) {
      const ok = PartSchema.safeParse({ ...tine, accent: { mesh: 'bent-toe', color } }).success;
      expect(ok, JSON.stringify(color)).toBe(OLD_INLINE.test(color));
    }
  });

  it('is the rule for a crooked room’s paper and floor', () => {
    const room = {
      id: 'test-room',
      name: 'Test Room',
      floor: 0,
      kind: 'main',
      box: { x: 0, z: 0, w: 4, d: 4 },
      look: { paper: '#c8b28a' },
      things: [],
      lamp: null,
    };
    expect(CrookedRoomSchema.safeParse(room).success).toBe(true);
    for (const color of [...GOOD, ...BAD]) {
      const paper = CrookedRoomSchema.safeParse({ ...room, look: { paper: color } }).success;
      const floor = CrookedRoomSchema.safeParse({
        ...room,
        look: { paper: '#c8b28a', floor: color },
      }).success;
      expect([paper, floor], JSON.stringify(color)).toEqual([
        OLD_INLINE.test(color),
        OLD_INLINE.test(color),
      ]);
    }
  });
});
