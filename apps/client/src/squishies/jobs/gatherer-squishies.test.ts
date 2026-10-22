import {
  hexKey,
  hexToWorld,
  type JobSquishy,
  type MapView,
  type WorkStatus,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { GATHERER_ON_TILE, HEX_SIZE, PLAYER_COLORS } from '../../map/map-config.js';
import { testPatch, userId } from '../../map/test-view.js';
import { planGatherers, standInSpecies } from './gatherer-squishies.js';

/** testPatch's land with a gatherer on the first `perKeeper` tiles each Keeper owns outside home. */
function busy(perKeeper: number): MapView {
  const view = testPatch(12);
  const given = new Map<string, number>();
  const tiles = view.tiles.map((t) => {
    if (t.ownerUserId === null || t.homeSlot !== null) return t;
    const n = given.get(t.ownerUserId) ?? 0;
    if (n >= perKeeper) return t;
    given.set(t.ownerUserId, n + 1);
    return { ...t, workers: 1 };
  });
  return { ...view, tiles };
}

const work = (q: number, r: number, over: Partial<WorkStatus> = {}): WorkStatus => ({
  q,
  r,
  resource: 'timber',
  from: 'land',
  cycleSeconds: 1800,
  speedPercent: 100,
  readyCycles: 0,
  ready: {},
  nextReadyAt: null,
  full: false,
  firelit: true,
  ...over,
});

function gatherer(id: string, at: WorkStatus, over: Partial<JobSquishy> = {}): JobSquishy {
  return {
    squishy: {
      id,
      mapId: '0190a8c4-0000-7000-8000-00000000000a',
      ownerUserId: userId(1),
      speciesId: 'mossmuffin',
      element: 'leaf',
      feeling: 'cozy',
      nickname: null,
      level: 4,
      xp: 0,
      state: 'active',
    },
    job: 'gatherer',
    teamSlot: null,
    post: null,
    habitatId: null,
    work: at,
    training: null,
    fullXpResetAt: null,
    gatherFits: ['timber'],
    houseRoomId: null,
    ...over,
  };
}

describe('planGatherers (#602)', () => {
  it('stands one squishy on every tile the map says has a gatherer, and nowhere else', () => {
    const view = busy(5);
    const plans = planGatherers(view, null);
    const working = view.tiles.filter((t) => (t.workers ?? 0) > 0).map(hexKey);
    expect(plans.map((p) => p.key).sort()).toEqual([...working].sort());
    expect(plans.length).toBe(20);
  });

  it("draws a patch-mate's gatherer as a plain squishy in its family's colour, never which one", () => {
    const view = busy(2);
    const plans = planGatherers(view, null);
    for (const plan of plans) {
      const slot = view.members.find((m) => m.user.id === plan.tile.ownerUserId)?.homeSlot ?? 0;
      expect(plan.mine).toBe(false);
      expect(plan.mark).toBeNull();
      expect(plan.species).toEqual(standInSpecies(PLAYER_COLORS[slot] ?? ''));
      // Seeded by the tile, not a squishy id the public view doesn't have.
      expect(plan.instanceId).toBe(plan.key);
    }
  });

  it('stands my gatherers there as themselves, with a mark only when they need me', () => {
    const view = busy(3);
    const mine = view.tiles.filter((t) => t.ownerUserId === userId(1) && (t.workers ?? 0) > 0);
    const [happy, glum, napping] = mine;
    const squishies = [
      gatherer('0190a000-0000-7000-8000-000000000001', work(happy!.q, happy!.r)),
      gatherer('0190a000-0000-7000-8000-000000000002', work(glum!.q, glum!.r), { gatherFits: [] }),
      gatherer(
        '0190a000-0000-7000-8000-000000000003',
        work(napping!.q, napping!.r, { full: true }),
      ),
    ];
    const plans = new Map(planGatherers(view, squishies).map((p) => [p.key, p]));
    expect(plans.get(hexKey(happy!))).toMatchObject({
      mine: true,
      mark: null,
      glum: false,
      instanceId: squishies[0]!.squishy.id,
    });
    expect(plans.get(hexKey(happy!))?.species.id).toBe('mossmuffin');
    expect(plans.get(hexKey(glum!))).toMatchObject({ mine: true, mark: 'meh', glum: true });
    expect(plans.get(hexKey(napping!))).toMatchObject({ mine: true, mark: 'napping', glum: false });
    // Patch-mates' tiles get no mark at all.
    const others = [...plans.values()].filter((p) => p.tile.ownerUserId !== userId(1));
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((p) => p.mark === null && !p.mine)).toBe(true);
  });

  it('stands it off the tile middle, the same spot every redraw', () => {
    const view = busy(1);
    const first = planGatherers(view, null);
    expect(planGatherers(view, null)).toEqual(first);
    for (const plan of first) {
      const middle = hexToWorld(plan.tile, HEX_SIZE);
      expect(plan.x).toBeCloseTo(middle.x + GATHERER_ON_TILE.offset.x);
      expect(plan.z).toBeCloseTo(middle.z + GATHERER_ON_TILE.offset.z);
      expect(plan.y).toBeGreaterThan(0);
    }
  });
});
