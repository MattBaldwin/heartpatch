import {
  CROOKED_HOUSE,
  findAvoidedWords,
  type JobSquishy,
  type JobsView,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  chestPoint,
  chestRooms,
  chestTarget,
  CROOKED_CHEST,
  crookedTeam,
  helpersFor,
  keepOffChest,
} from './crooked-bonus.js';
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
    const at = keepOffChest(r, { x: p.x, z: p.z - 0.1 });
    expect(Math.hypot(at.x - p.x, at.z - p.z)).toBeCloseTo(CROOKED_WALK.margin + 0.2);
    const clear = { x: p.x, z: p.z - 1.2 };
    expect(keepOffChest(r, clear)).toEqual(clear);
    // Main rooms have no chest to bump.
    const hall = room('front-hall');
    expect(keepOffChest(hall, { x: 0, z: 0 })).toEqual({ x: 0, z: 0 });
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
      ...['fire', 'leaf', 'water', 'light'].map((p) => powerDone(p, 'Glowboo')),
    ];
    for (const line of lines) {
      expect(findAvoidedWords(line)).toEqual([]);
      expect(line.split(/\s+/).length).toBeLessThanOrEqual(14);
    }
    expect(BONUS_TEXT.pickerLine('the cold fireplace', 'Fire')).toBe(
      'The cold fireplace needs a Fire friend.',
    );
  });
});
