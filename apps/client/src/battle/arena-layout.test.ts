import { TERRAINS } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { TERRAIN_LOOKS } from '../map/map-config.js';
import { ARENA_MOODS, ARENA_SPECS, ARENA_STAGE } from './arena-config.js';
import { arenaPlan, arenaProps, arenaSeed, groundColor, skyAt, skyColors } from './arena-layout.js';

const luminance = (rgb: readonly number[]) =>
  0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0);

describe('arenaPlan (every terrain has its own arena)', () => {
  it.each(TERRAINS.map((t) => t.id))('%s has an arena and the map look', (id) => {
    expect(ARENA_SPECS[id]).toBeDefined();
    expect(TERRAIN_LOOKS[id]).toBeDefined();
    const plan = arenaPlan(id, 'day');
    expect(plan).toMatchObject({ terrain: id, known: true, spec: ARENA_SPECS[id] });
    // The arena is drawn from the map's own look for the terrain.
    expect(plan.look).toBe(TERRAIN_LOOKS[id]);
  });

  it('has no arena for a terrain the game data lacks', () => {
    const ids = new Set(TERRAINS.map((t) => t.id));
    for (const id of Object.keys(ARENA_SPECS)) expect(ids.has(id)).toBe(true);
  });

  it("draws a terrain this client doesn't know as the meadow, and says so", () => {
    const plan = arenaPlan('cloud-castle', 'night');
    expect(plan).toMatchObject({ terrain: 'cloud-castle', known: false, timeOfDay: 'night' });
    expect(plan.spec).toBe(ARENA_SPECS['meadow']);
    expect(plan.mood).toBe(ARENA_MOODS.night);
  });

  it('gives every terrain something to look at', () => {
    for (const t of TERRAINS) {
      expect(arenaProps(ARENA_SPECS[t.id]!, 1).length).toBeGreaterThan(0);
    }
  });
});

describe('arenaProps', () => {
  const spec = ARENA_SPECS['forest']!;

  it('scatters the same way for the same battle, differently for another', () => {
    const seed = arenaSeed('01a10948-604f-73db-bbd4-5cad0847932b');
    expect(arenaProps(spec, seed)).toEqual(arenaProps(spec, seed));
    expect(arenaProps(spec, seed)).not.toEqual(arenaProps(spec, seed + 1));
  });

  it('keeps props out of the fight, and big ones behind it and to the sides', () => {
    for (const t of TERRAINS) {
      const s = ARENA_SPECS[t.id]!;
      for (let seed = 0; seed < 20; seed++) {
        for (const p of arenaProps(s, seed)) {
          expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(ARENA_STAGE.clearRadius);
          expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(ARENA_STAGE.groundRadius);
          const group = s.props.find((g) => g.kind === p.kind);
          if (!group?.front) {
            // Angle off "straight behind" (+z); never in front of the fighters.
            expect(Math.abs(Math.atan2(p.x, p.z))).toBeLessThanOrEqual(ARENA_STAGE.propArc + 1e-9);
          }
        }
      }
    }
  });

  it('thins props out on the low quality tier', () => {
    const all = arenaProps(spec, 3).length;
    const low = arenaProps(spec, 3, ARENA_STAGE.lowTierProps).length;
    expect(low).toBeLessThan(all);
    expect(low).toBeGreaterThan(0);
  });
});

describe('time of day', () => {
  it('makes night darker than dusk, and dusk darker than day', () => {
    const zenith = (time: 'day' | 'dusk' | 'night') =>
      luminance(skyColors(arenaPlan('meadow', time)).zenith);
    expect(zenith('night')).toBeLessThan(zenith('dusk'));
    expect(zenith('dusk')).toBeLessThan(zenith('day'));
    expect(ARENA_MOODS.night.lightIntensity).toBeLessThan(ARENA_MOODS.day.lightIntensity);
    expect(ARENA_MOODS.night.environment).toBeLessThan(ARENA_MOODS.day.environment);
    expect(ARENA_MOODS.night.night).toBe(true);
  });

  it("tints the ground for the time of day, but keeps the terrain's colour by day", () => {
    const day = groundColor(arenaPlan('forest', 'day'));
    const night = groundColor(arenaPlan('forest', 'night'));
    expect(day.map((v) => Math.round(v * 255))).toEqual([0x93, 0xd6, 0xa0]);
    expect(night).not.toEqual(day);
  });

  it('runs the sky from the land below, through the haze, to the zenith', () => {
    const sky = skyColors(arenaPlan('lake', 'day'));
    expect(skyAt(sky, 1)).toEqual(sky.zenith);
    expect(skyAt(sky, 0)).toEqual(sky.horizon);
    expect(skyAt(sky, -1)).toEqual(sky.below);
  });

  it("puts the lake's shore under the fighters, not water", () => {
    const plan = arenaPlan('lake', 'day');
    expect(plan.spec.water).not.toBeNull();
    expect(groundColor(plan)).not.toEqual(
      groundColor({ ...plan, spec: { ...plan.spec, ground: undefined } }),
    );
  });
});
