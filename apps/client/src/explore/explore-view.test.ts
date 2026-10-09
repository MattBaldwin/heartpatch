import {
  EXPLORE_RULES,
  findAvoidedWords,
  type ExploreTileResponse,
  type SearchSpotResponse,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { EXPLORE_VIEW } from './explore-config.js';
import {
  actionFor,
  afterSearch,
  clampToTile,
  EXPLORE_TEXT,
  findLines,
  insideTile,
  joystickVector,
  missingTool,
  nearestSpot,
  needLine,
  spotInReach,
  progressLine,
  restLine,
  standBeside,
  stepToward,
  toolRecipeRows,
  usesLine,
  xpLines,
} from './explore-view.js';

const SQRT3_2 = Math.sqrt(3) / 2;

const spot = (index: number, x: number, z: number, done = false) => ({
  index,
  kind: 'rock',
  tool: null,
  x,
  z,
  done,
});

const found = (over: Partial<SearchSpotResponse> = {}): SearchSpotResponse => ({
  spot: 2,
  found: {},
  lore: null,
  clothing: null,
  notable: null,
  xp: [],
  tool: null,
  progress: { searched: 3, total: 10 },
  explored: false,
  homestead: null,
  items: {},
  ...over,
});

describe('explore text', () => {
  it('counts what is left, then celebrates', () => {
    expect(progressLine({ searched: 7, total: 12 })).toBe('7 of 12 found 🔍');
    expect(progressLine({ searched: 12, total: 12 })).toBe('All 12 found! ✨');
  });

  it('says how many uses a tool has left, and when it needs a rest', () => {
    expect(usesLine('net', 12)).toBe('12 scoops left');
    expect(usesLine('shovel', 1)).toBe('1 dig left');
    expect(usesLine('rope', 0)).toBe('Resting zZ');
    expect(needLine('rope')).toBe('You need a Rope to climb up there!');
    expect(restLine('shovel')).toBe('Your Shovel needs a rest! Craft a new one 🛠️');
  });

  it('gives every spot kind an action', () => {
    for (const kind of EXPLORE_RULES.spotKinds) {
      const action = actionFor({ kind: kind.id, tool: kind.tool });
      expect(action.interaction).toBe(kind.interaction);
      expect(action.label.length).toBeGreaterThan(0);
    }
    expect(actionFor({ kind: 'mound', tool: 'shovel' }).label).toBe('Dig');
    expect(actionFor({ kind: 'tree', tool: null }).label).toBe('Shake');
  });

  it('lists a tool recipe against the bag', () => {
    const rows = toolRecipeRows('rope', { greens: 1 });
    expect(rows).toEqual([{ id: 'greens', text: '🌿 Greens 1/4', enough: false }]);
    expect(toolRecipeRows('shovel', { timber: 9, stone: 9 }).every((r) => r.enough)).toBe(true);
  });

  it('turns a find into card lines, or a wiggly worm', () => {
    expect(findLines(found())).toEqual([{ kind: 'none', text: EXPLORE_TEXT.worm }]);
    const lines = findLines(
      found({
        found: { timber: 2 },
        lore: { id: 'under-a-mossy-rock', title: 'Under a Mossy Rock' },
      }),
    );
    expect(lines.map((l) => l.kind)).toEqual(['item', 'lore']);
    expect(lines[0]?.text).toContain('Timber ×2');
    // A page says where it went (#307).
    expect(lines[1]).toMatchObject({ note: 'Added to your Lorebook 📖' });
    expect(lines[0]?.note).toBeUndefined();
    expect(xpLines([{ squishyId: 'a', xp: 6 }], { a: 'Puddlepuff' })).toEqual(['Puddlepuff +6 XP']);
  });

  it('keeps the words kind (style guide §8, §9)', () => {
    for (const line of Object.values(EXPLORE_TEXT)) {
      if (typeof line === 'string') expect(findAvoidedWords(line)).toEqual([]);
    }
  });
});

describe('a search changes the tile on screen', () => {
  it('marks the spot done and keeps the tool count', () => {
    const tile: ExploreTileResponse = {
      q: 1,
      r: 2,
      terrain: 'meadow',
      spots: [spot(1, 0, 0), spot(2, 0.3, 0)],
      needs: ['shovel'],
      progress: { searched: 2, total: 10 },
      homestead: null,
      tools: { shovel: 20, net: 0, rope: 0, lantern: 0 },
    };
    const next = afterSearch(
      tile,
      found({ tool: { id: 'shovel', usesLeft: 19 }, homestead: 'joined' }),
    );
    expect(next.spots.map((s) => s.done)).toEqual([false, true]);
    expect(next.tools.shovel).toBe(19);
    expect(next.homestead).toBe('joined');
    expect(next.progress).toEqual({ searched: 3, total: 10 });
  });

  it('knows which tool a spot is missing', () => {
    expect(missingTool({ tool: null }, {})).toBeNull();
    expect(missingTool({ tool: 'net' }, { net: 0 })).toBe('net');
    expect(missingTool({ tool: 'net' }, { net: 3 })).toBeNull();
  });
});

describe('walking on the tile', () => {
  it('keeps the Keeper inside the tile', () => {
    const margin = EXPLORE_VIEW.edgeMargin;
    expect(clampToTile({ x: 0, z: 0 })).toEqual({ x: 0, z: 0 });
    const side = clampToTile({ x: 5, z: 0 });
    expect(side.x).toBeCloseTo(SQRT3_2 - margin);
    expect(side.z).toBeCloseTo(0);
    for (const angle of [0, 0.5, 1, 1.6, 2.4, 3, 4, 5.2]) {
      const p = clampToTile({ x: Math.cos(angle) * 4, z: Math.sin(angle) * 4 });
      expect(insideTile(p), `angle ${String(angle)}`).toBe(true);
    }
    // The top corner is further out than the sides (pointy-topped tiles).
    expect(insideTile({ x: 0, z: 0.85 })).toBe(true);
    expect(insideTile({ x: 0.85, z: 0 })).toBe(false);
  });

  it('walks towards a point and stops on it', () => {
    expect(stepToward({ x: 0, z: 0 }, { x: 0.5, z: 0 }, 0.1)).toEqual({ x: 0.1, z: 0 });
    expect(stepToward({ x: 0.45, z: 0 }, { x: 0.5, z: 0 }, 0.1)).toEqual({ x: 0.5, z: 0 });
  });

  it('stops beside a spot, within reach of it', () => {
    const at = standBeside({ x: -0.6, z: 0 }, { x: 0.2, z: 0 });
    expect(at.x).toBeLessThan(0.2);
    expect(nearestSpot(at, [spot(0, 0.2, 0)])?.index).toBe(0);
  });

  it('finds the nearest spot not searched yet', () => {
    const spots = [spot(0, 0.05, 0, true), spot(1, 0.1, 0), spot(2, 0.6, 0)];
    expect(nearestSpot({ x: 0, z: 0 }, spots)?.index).toBe(1);
    expect(nearestSpot({ x: -0.5, z: 0 }, spots)).toBeNull();
  });

  it('offers the spot the player tapped over a nearer one beside it', () => {
    const spots = [spot(0, 0.05, 0), spot(1, 0.12, 0), spot(2, 0.12, 0, true)];
    expect(spotInReach({ x: 0, z: 0 }, spots, null)?.index).toBe(0);
    expect(spotInReach({ x: 0, z: 0 }, spots, 1)?.index).toBe(1);
    // Searched already, or out of reach: the nearest again.
    expect(spotInReach({ x: 0, z: 0 }, spots, 2)?.index).toBe(0);
    expect(spotInReach({ x: -0.5, z: 0 }, [spot(1, 0.3, 0)], 1)).toBeNull();
  });

  it('reads the joystick as a direction on the ground', () => {
    expect(joystickVector(2, 2)).toEqual({ x: 0, z: 0 });
    const up = joystickVector(0, -200);
    expect(up.x).toBeCloseTo(0);
    expect(up.z).toBeCloseTo(1);
    const right = joystickVector(EXPLORE_VIEW.joystick.radius / 2, 0);
    expect(right.x).toBeGreaterThan(0);
    expect(right.x).toBeLessThan(1);
  });
});
