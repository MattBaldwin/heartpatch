import {
  CROOKED_HOUSE,
  findAvoidedWords,
  type JobSquishy,
  type JobsView,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { ELEMENT_FX } from '../../battle/element-fx.js';
import { CHEST_SIZE, WOKEN_COLOUR } from './crooked-bonus-kit.js';
import {
  DOOR_LIGHT,
  MAX_SPARKLES,
  doorLightColours,
  doorLightLayout,
  doorLightPoints,
  offScreen,
  outlinePath,
  sparkleShape,
  sparkles,
} from './crooked-door-light.js';
import {
  chestPoint,
  chestRooms,
  chestTarget,
  CROOKED_CHEST,
  crookedTeam,
  helpersFor,
} from './crooked-bonus.js';
import { CROOKED_BODY, houseStep } from './crooked-furniture.js';
import { CROOKED_WALK, roomOf } from './crooked-plan.js';
import { BONUS_TEXT, lootWords, powerDone } from './crooked-text.js';

const room = (id: string) => {
  const r = roomOf(id);
  if (!r) throw new Error(id);
  return r;
};
const door = (id: string) => {
  const d = CROOKED_HOUSE.doors.find((x) => x.id === id);
  if (!d) throw new Error(id);
  return d;
};

const id = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

function squishy(
  n: number,
  over: {
    element?: string;
    level?: number;
    job?: JobSquishy['job'];
    slot?: number;
    away?: boolean;
  } = {},
): JobSquishy {
  return {
    squishy: {
      id: id(n),
      mapId: id(100),
      ownerUserId: id(200),
      speciesId: over.element === 'fire' ? 'candlekit' : 'puddlepuff',
      element: (over.element ?? 'water') as JobSquishy['squishy']['element'],
      feeling: 'silly',
      nickname: null,
      level: over.level ?? 5,
      xp: 0,
      state: over.away ? 'hollowed' : 'active',
    },
    job: over.job ?? 'resting',
    teamSlot: over.slot ?? null,
    post: null,
    habitatId: null,
    work: null,
    training: null,
    fullXpResetAt: null,
    gatherFits: [],
    houseRoomId: null,
  };
}

function jobs(
  squishies: JobSquishy[],
  teamSize = 3,
): Pick<JobsView, 'squishies' | 'rules' | 'names'> {
  return {
    squishies,
    rules: { teamSize, maxStoredCycles: 4 },
    names: Object.fromEntries(squishies.map((s, i) => [s.squishy.id, `Pal ${String(i + 1)}`])),
  };
}

describe('bonus chests', () => {
  it('stand in each of the four bonus rooms, inside their walls', () => {
    expect(chestRooms().map((r) => r.id)).toEqual([
      'pantry',
      'inglenook',
      'hanging-garden',
      'lantern-closet',
    ]);
    for (const r of chestRooms()) {
      const p = chestPoint(r);
      expect(Math.abs(p.x - r.box.x)).toBeLessThan(r.box.w / 2 - CROOKED_WALK.margin);
      expect(Math.abs(p.z - r.box.z)).toBeLessThan(r.box.d / 2 - CROOKED_WALK.margin);
    }
  });

  it('are in reach close by, until opened', () => {
    const r = room('inglenook');
    const p = chestPoint(r);
    const near = { x: p.x, z: p.z - 1 };
    expect(chestTarget(r, { chestsOpened: [] }, near)).toMatchObject({ kind: 'chest', room: r });
    expect(chestTarget(r, { chestsOpened: ['inglenook'] }, near)).toBeNull();
    const far = { x: p.x, z: p.z - CROOKED_CHEST.reach - 0.1 };
    expect(chestTarget(r, { chestsOpened: [] }, far)).toBeNull();
  });

  it('are never in a main room (the attic is #306 6f)', () => {
    const r = room('parlour');
    expect(chestTarget(r, { chestsOpened: [] }, { x: r.box.x, z: r.box.z })).toBeNull();
    expect(chestTarget(room('attic'), { chestsOpened: [] }, { x: 0, z: 5.6 })).toBeNull();
  });

  it('stop the Keeper beside them', () => {
    const r = room('pantry');
    const p = chestPoint(r);
    const view = { rooms: [], unlocked: [], bonusOpen: [], keys: [] };
    const step = (to: { x: number; z: number }) => houseStep(r, view, to, to).at;
    const at = step({ x: p.x, z: p.z - 0.1 });
    expect(p.z - at.z).toBeCloseTo(CHEST_SIZE.d / 2 + CROOKED_BODY.radius + CROOKED_BODY.pad);
    const clear = { x: p.x, z: p.z - 1.2 };
    expect(step(clear)).toEqual(clear);
  });
});

describe('who can help', () => {
  it('is the team I picked, in slot order', () => {
    const team = crookedTeam(
      jobs([
        squishy(1, { job: 'team', slot: 1 }),
        squishy(2, { job: 'team', slot: 0 }),
        squishy(3, { level: 30 }),
      ]),
    );
    expect(team.map((s) => s.squishy.id)).toEqual([id(2), id(1)]);
  });

  it('with no team picked, is my strongest free squishies, as many as a team holds', () => {
    const team = crookedTeam(
      jobs(
        [
          squishy(1, { level: 3 }),
          squishy(2, { level: 9 }),
          squishy(3, { level: 6 }),
          squishy(4, { level: 20, job: 'gatherer' }),
          squishy(5, { level: 30, away: true }),
        ],
        2,
      ),
    );
    expect(team.map((s) => s.squishy.id)).toEqual([id(2), id(3)]);
  });

  it('lists the door’s element first, the rest shown but not able to help', () => {
    const rows = helpersFor(
      door('inglenook-door'),
      jobs([
        squishy(1, { job: 'team', slot: 0 }),
        squishy(2, { job: 'team', slot: 1, element: 'fire' }),
      ]),
    );
    expect(rows.map((r) => [r.id, r.helps])).toEqual([
      [id(2), true],
      [id(1), false],
    ]);
    expect(rows[0]).toMatchObject({ name: 'Pal 2', speciesId: 'candlekit', element: 'fire' });
  });

  it('can be nobody (the picker says how to fix it)', () => {
    const rows = helpersFor(door('closet-door'), jobs([squishy(1)]));
    expect(rows.some((r) => r.helps)).toBe(false);
    expect(helpersFor(door('closet-door'), jobs([]))).toEqual([]);
  });

  it('only for a power door', () => {
    const rows = helpersFor(door('north-door'), jobs([squishy(1, { element: 'fire' })]));
    expect(rows.every((r) => !r.helps)).toBe(true);
  });
});

describe('woken door cue', () => {
  const at = (x: number, y: number) => ({ x, y });
  it('fits an upright doorway round the door’s corners, its sparkles anchored at its foot', () => {
    const layout = doorLightLayout({
      footLeft: at(160, 500),
      footRight: at(240, 500),
      topLeft: at(162, 300),
      topRight: at(238, 300),
    });
    expect(layout?.box).toEqual({ left: 160, top: 300, width: 80, height: 200 });
    expect(layout?.foot).toEqual({ x: 200, y: 500 });
    expect(layout?.height).toBe(200);
  });

  it('keeps an edge-on door (a side wall seen from above) a slim door, not a crack', () => {
    // The wall runs up the screen and the door's height does too: a 5 px sliver.
    const layout = doorLightLayout({
      footLeft: at(200, 520),
      footRight: at(204, 400),
      topLeft: at(201, 460),
      topRight: at(205, 340),
    });
    expect(layout?.box.height).toBe(180);
    expect(layout?.box.width).toBeCloseTo(180 * DOOR_LIGHT.slim);
    // About its own middle.
    expect((layout?.box.left ?? 0) + (layout?.box.width ?? 0) / 2).toBeCloseTo(202.5);
  });

  it('draws the outline as one path: up a side, round the top, down the other, open at the floor', () => {
    const box = { left: 100, top: 300, width: 80, height: 200 };
    const r = DOOR_LIGHT.round;
    const d = outlinePath(box);
    // One shape, so the glow is even with no brighter joins.
    expect(d.match(/M/g)).toHaveLength(1);
    expect(d.startsWith('M100 500V')).toBe(true);
    expect(d).toContain(`H${String(180 - r)}`);
    expect(d.endsWith('V500')).toBe(true);
    expect(d.match(/A/g)).toHaveLength(2);
    // The fill is the same shape shut along the floor.
    expect(outlinePath(box, true)).toBe(`${d}Z`);
  });

  it('keeps a narrow doorway’s round top no wider than the doorway', () => {
    const d = outlinePath({ left: 0, top: 0, width: 10, height: 40 });
    expect(d).toContain('A5 5');
  });

  it('draws nothing while a corner of the door is off screen', () => {
    expect(
      doorLightLayout({
        footLeft: null,
        footRight: at(0, 0),
        topLeft: at(0, 0),
        topRight: at(0, 0),
      }),
    ).toBeNull();
  });

  it('hides a door well past the screen’s edge, so its sparkles stop', () => {
    const view = { width: 393, height: 852 };
    const door = (x: number) =>
      doorLightLayout({
        footLeft: at(x, 500),
        footRight: at(x + 80, 500),
        topLeft: at(x, 300),
        topRight: at(x + 80, 300),
      });
    const onScreen = door(150);
    const offRight = door(393 + DOOR_LIGHT.offscreen + 10);
    const peeking = door(-30);
    expect(onScreen && offScreen(onScreen, view)).toBe(false);
    expect(offRight && offScreen(offRight, view)).toBe(true);
    expect(peeking && offScreen(peeking, view)).toBe(false);
  });

  it('puts the outline round the door slab in the wall, just in front of it', () => {
    // A door in the west wall, the room towards +x.
    const p = doorLightPoints({ x: -9, z: 0 }, { x: 1, z: 0 });
    expect(p.footLeft[0].x).toBeCloseTo(-9 + DOOR_LIGHT.lift);
    expect(Math.abs(p.footLeft[0].z - p.footRight[0].z)).toBeCloseTo(DOOR_LIGHT.doorway.half * 2);
    expect(p.topLeft[1]).toBe(DOOR_LIGHT.doorway.height);
    expect(p.footRight[1]).toBe(0);
  });

  it('gives each power its own sparkles: embers, leaves, droplets and star motes', () => {
    expect(['fire', 'leaf', 'water', 'light'].map(sparkleShape)).toEqual([
      'puff',
      'leaf',
      'drop',
      'star',
    ]);
  });

  it('keeps a few sparkles a door, staggered, in the door’s own colours', () => {
    const bits = sparkles('fire');
    expect(bits.length).toBeGreaterThan(0);
    expect(bits.length).toBeLessThanOrEqual(MAX_SPARKLES);
    // Staggered: no two start at the same moment of their loop.
    expect(new Set(bits.map((b) => (b.delay / b.seconds).toFixed(3))).size).toBe(bits.length);
    const { glow, hot } = doorLightColours('fire');
    expect(bits.some((b) => b.colour === glow || b.colour === hot)).toBe(true);
    // The same every time (captures match).
    expect(sparkles('fire')).toEqual(bits);
  });

  it('keeps Light’s glow a clear yellow, not the element’s pale cream', () => {
    const { glow } = doorLightColours('light');
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(glow.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(200);
    expect(b ?? 255).toBeLessThan(100);
    expect(g).toBeGreaterThan(150);
  });

  it('takes each power’s colour from the element palette, lightened', () => {
    for (const p of ['fire', 'leaf', 'water', 'light']) {
      const own = Number.parseInt((ELEMENT_FX[p]?.colors[0] ?? '#000000').slice(1), 16);
      const woken = Number.parseInt((WOKEN_COLOUR[p] ?? '#000000').slice(1), 16);
      // Each channel is at least the element's own, never beyond white.
      for (const shift of [16, 8, 0]) {
        expect((woken >> shift) & 255).toBeGreaterThanOrEqual((own >> shift) & 255);
      }
    }
  });
});

describe('bonus words', () => {
  it('name each power’s moment, with a kind fallback', () => {
    expect(powerDone('fire', 'Candlekit')).toBe('Candlekit lit the fireplace! 🔥');
    expect(powerDone('frost', 'Pip')).toBe('Pip opened the way! ✨');
  });

  it('list a chest’s loot', () => {
    const name = (i: string) =>
      ({ treats: 'Treats', heartdust: 'Heartdust', glimmer: 'Glimmer' })[i] ?? i;
    expect(lootWords({ treats: 4 }, name)).toBe('4 Treats');
    expect(lootWords({ treats: 4, heartdust: 1 }, name)).toBe('4 Treats and 1 Heartdust');
    expect(lootWords({ treats: 4, heartdust: 1, glimmer: 2, nothing: 0 }, name)).toBe(
      '4 Treats, 1 Heartdust and 2 Glimmer',
    );
    expect(lootWords({}, name)).toBe('');
  });

  it('stay short and kind', () => {
    const lines = [
      BONUS_TEXT.pickerTitle('🔥'),
      BONUS_TEXT.pickerLine('the cold fireplace', 'Fire'),
      BONUS_TEXT.nobody('Fire', '🔥'),
      BONUS_TEXT.notThisOne('Fire'),
      BONUS_TEXT.chestAction,
      BONUS_TEXT.chestBubble,
      BONUS_TEXT.chestTitle,
      BONUS_TEXT.chestLine('4 Treats'),
      BONUS_TEXT.chestEmpty,
      BONUS_TEXT.chestWear,
      BONUS_TEXT.friendTitle,
      BONUS_TEXT.friendLine('Glowboo'),
      BONUS_TEXT.friendGo,
      BONUS_TEXT.wokeLine('Hanging Garden'),
      BONUS_TEXT.wokeLineAny,
      ...['fire', 'leaf', 'water', 'light'].map((p) => powerDone(p, 'Glowboo')),
    ];
    for (const line of lines) {
      expect(findAvoidedWords(line)).toEqual([]);
      expect(line.split(/\s+/).length).toBeLessThanOrEqual(14);
    }
    expect(BONUS_TEXT.pickerLine('the cold fireplace', 'Fire')).toBe(
      'The cold fireplace needs a Fire friend.',
    );
    expect(BONUS_TEXT.pickerLine('the flames', 'Water')).toBe('The flames need a Water friend.');
    expect(BONUS_TEXT.pickerLine('the dark closet', 'Light')).toBe(
      'The dark closet needs a Light friend.',
    );
    expect(BONUS_TEXT.pickerLine('the glass', 'Leaf')).toBe('The glass needs a Leaf friend.');
  });
});
