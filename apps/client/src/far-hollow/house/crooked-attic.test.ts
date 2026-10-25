import { CROOKED_HOUSE, type CrookedHouseView } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  atticChestPoint,
  atticLines,
  atticRoom,
  atticTarget,
  CROOKED_ATTIC,
  scrapsLeft,
} from './crooked-attic.js';
import { houseStep } from './crooked-furniture.js';
import { CROOKED_ATTIC_TEXT } from './crooked-text.js';

const attic = atticRoom()!;
const chest = atticChestPoint(attic);
const rooms = (dark: number): CrookedHouseView['rooms'] =>
  CROOKED_HOUSE.rooms
    .filter((r) => r.kind === 'main')
    .map((r, i) => ({ id: r.id, fixed: [], bloomed: i >= dark }));

describe('the Crooked House’s attic (#306 6f)', () => {
  it('has one attic, its big chest under the window in the middle of the room', () => {
    expect(attic.kind).toBe('attic');
    expect(chest.x).toBe(attic.box.x);
    expect(chest.z).toBeGreaterThan(attic.box.z);
    expect(chest.z + CROOKED_ATTIC.half.z).toBeLessThan(attic.box.z + attic.box.d / 2);
  });

  it('counts the rooms (story scraps) the page still needs', () => {
    expect(scrapsLeft({ rooms: rooms(0) })).toBe(0);
    expect(scrapsLeft({ rooms: rooms(3) })).toBe(3);
  });

  it('names the chest only in the attic, in reach, and until it is opened', () => {
    const near = { x: chest.x, z: chest.z - 1.2 };
    expect(atticTarget(attic, { chestsOpened: [] }, near)).toMatchObject({ kind: 'attic' });
    expect(atticTarget(attic, { chestsOpened: [attic.id] }, near)).toBeNull();
    expect(atticTarget(attic, { chestsOpened: [] }, { x: chest.x, z: chest.z - 4 })).toBeNull();
    const landing = CROOKED_HOUSE.rooms.find((r) => r.id === 'landing')!;
    expect(atticTarget(landing, { chestsOpened: [] }, near)).toBeNull();
  });

  it('stops the Keeper beside the chest, never inside it', () => {
    const view = { rooms: [], unlocked: [], bonusOpen: [], keys: [] };
    const step = (to: { x: number; z: number }) => houseStep(attic, view, to, to).at;
    const inside = step({ x: chest.x + 0.2, z: chest.z - 0.1 });
    const out =
      Math.abs(inside.x - chest.x) >= CROOKED_ATTIC.half.x ||
      Math.abs(inside.z - chest.z) >= CROOKED_ATTIC.half.z;
    expect(out).toBe(true);
    const free = { x: chest.x, z: chest.z - 2 };
    expect(step(free)).toEqual(free);
  });

  it('says what the big chest gave, a line each (owner decision 4)', () => {
    const lines = atticLines(
      {
        find: {
          found: { heartdust: 13, glimmer: 25, treats: 5 },
          lore: { id: 'the-crooked-house', title: 'A Lantern in Every Room' },
          clothing: 'lantern-keepers-cloak',
          notable: 'lore',
          xp: [],
        },
      },
      { item: (id) => id.toUpperCase(), clothing: () => 'Lantern Keeper’s Cloak' },
    );
    expect(lines).toEqual([
      CROOKED_ATTIC_TEXT.page('A Lantern in Every Room'),
      CROOKED_ATTIC_TEXT.cloak('Lantern Keeper’s Cloak'),
      CROOKED_ATTIC_TEXT.titleLine,
      CROOKED_ATTIC_TEXT.pile(['13 HEARTDUST', '25 GLIMMER', '5 TREATS']),
    ]);
    // The chest's 10 Heartdust and 25 Glimmer and the gift's 3 Heartdust and 5 Treats, summed
    // (the server's attic test checks the grant itself).
    expect(lines.at(-1)).toBe(
      '🎁 13 HEARTDUST, 25 GLIMMER and 5 TREATS, from the chest and the far Hollow’s gift',
    );
    expect(CROOKED_ATTIC_TEXT.cloak("Lantern Keeper's Cloak")).toBe(
      '🧥 Lantern Keeper’s Cloak to wear',
    );
    expect(CROOKED_ATTIC_TEXT.faint(1)).toMatch(/1 more room right/);
    expect(CROOKED_ATTIC_TEXT.faint(3)).toMatch(/3 more rooms right/);
  });

  it('ends a tap-walk into the chest beside it, so the walk stops (no frame after frame)', () => {
    const view = { rooms: [], unlocked: [], bonusOpen: [], keys: [] };
    // Walk from the ladder straight at the chest's middle, as a tap on it does.
    let at = { x: chest.x, z: attic.box.z - 1.6 };
    let steps = 0;
    for (; steps < 600; steps++) {
      const d = Math.hypot(chest.x - at.x, chest.z - at.z);
      const k = Math.min(1, 0.05 / d);
      const next = houseStep(attic, view, at, {
        x: at.x + (chest.x - at.x) * k,
        z: at.z + (chest.z - at.z) * k,
      }).at;
      if (next.x === at.x && next.z === at.z) break;
      at = next;
    }
    expect(steps).toBeLessThan(600);
    expect(chest.z - at.z).toBeGreaterThanOrEqual(CROOKED_ATTIC.half.z);
  });
});
