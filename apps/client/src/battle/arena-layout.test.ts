import { GAME_DATA } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { TERRAIN_LOOKS } from '../map/map-config.js';
import { ARENA_SPECS, ARENA_STAGE } from './arena-config.js';
import {
  arenaClouds,
  arenaHills,
  arenaMotes,
  arenaPlan,
  arenaProps,
  arenaSeed,
  arenaStars,
  FIGHTER_HOMES,
  groundColor,
  groundShade,
  hexRgb,
  moteAt,
  rgbHex,
  skyAt,
  skyColors,
  sunPlacement,
  waterColor,
} from './arena-layout.js';

describe('arenaPlan', () => {
  it('has an arena and the map look for every terrain in the game data', () => {
    for (const terrain of GAME_DATA.terrains) {
      const plan = arenaPlan(terrain.id, 'day', 1);
      expect(plan.known, terrain.id).toBe(true);
      expect(ARENA_SPECS[terrain.id]).toBeDefined();
      expect(TERRAIN_LOOKS[terrain.id]).toBeDefined();
    }
  });

  it('draws the meadow for a terrain it does not know, and says so', () => {
    const plan = arenaPlan('moon-base', 'night', 1);
    expect(plan.known).toBe(false);
    expect(plan.spec).toBe(ARENA_SPECS['meadow']);
    expect(plan.terrain).toBe('moon-base');
    expect(plan.mood.night).toBe(true);
  });

  it('seeds one battle the same way every time', () => {
    const id = '01a10948-604f-73db-bbd4-5cad0847932b';
    expect(arenaSeed(id)).toBe(arenaSeed(id));
    expect(arenaSeed(id)).not.toBe(arenaSeed('01a10948-604f-73db-bbd4-5cad0847932c'));
    expect(arenaProps(ARENA_SPECS['forest']!, arenaSeed(id))).toEqual(
      arenaProps(ARENA_SPECS['forest']!, arenaSeed(id)),
    );
  });
});

describe('arenaProps', () => {
  it('keeps every prop out of the fight, off the fighters and out of the camera lane', () => {
    for (const [terrain, spec] of Object.entries(ARENA_SPECS)) {
      for (const seed of [1, 777, 99_000]) {
        const props = arenaProps(spec, seed);
        expect(props.length, terrain).toBeGreaterThan(0);
        for (const p of props) {
          expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(ARENA_STAGE.clearRadius);
          for (const h of FIGHTER_HOMES) {
            expect(Math.hypot(p.x - h.x, p.z - h.z)).toBeGreaterThanOrEqual(
              ARENA_STAGE.fighterClear,
            );
          }
          const group = spec.props.find((g) => g.kind === p.kind);
          const front = spec.props.some((g) => g.kind === p.kind && g.front);
          if (!front) {
            // Big props never stand between the camera and the fight.
            const inLane =
              p.z < ARENA_STAGE.cameraLane.z && Math.abs(p.x) < ARENA_STAGE.cameraLane.halfWidth;
            expect(inLane, `${terrain} ${p.kind}`).toBe(false);
          }
          expect(p.scale).toBeGreaterThanOrEqual(group?.scale[0] ?? 0);
        }
      }
    }
  });

  it('thins the props on the low tier but keeps at least one of each group', () => {
    const spec = ARENA_SPECS['forest']!;
    const full = arenaProps(spec, 5);
    const low = arenaProps(spec, 5, ARENA_STAGE.lowTier.props);
    expect(low.length).toBeLessThan(full.length);
    for (const g of spec.props) expect(low.some((p) => p.kind === g.kind)).toBe(true);
  });
});

describe('the backdrop', () => {
  it('rings the far hills, clouds and stars round the dome, inside it', () => {
    for (const h of arenaHills(3)) {
      expect(Math.hypot(h.x, h.z)).toBeGreaterThan(ARENA_STAGE.groundRadius);
      expect(h.z).toBeGreaterThan(-10); // behind the fight and beside it, never in front
    }
    for (const c of arenaClouds(3, 4))
      expect(Math.hypot(c.x, c.y, c.z)).toBeLessThan(ARENA_STAGE.skyRadius);
    const stars = arenaStars();
    expect(stars).toHaveLength(ARENA_STAGE.stars);
    for (const s of stars) {
      expect(s.y).toBeGreaterThan(0);
      expect(Math.hypot(s.x, s.y, s.z)).toBeLessThan(ARENA_STAGE.skyRadius);
    }
  });

  it('drifts each mote a little and never far', () => {
    const motes = arenaMotes(9, 40);
    expect(motes).toHaveLength(40);
    for (const m of motes) {
      const at = moteAt(m, 12.5);
      expect(Math.hypot(at.x - m.x, at.y - m.y, at.z - m.z)).toBeLessThan(1);
      expect(moteAt(m, 0)).toEqual(moteAt(m, 0));
    }
  });
});

describe('colours', () => {
  it('round-trips hex', () => {
    expect(rgbHex(hexRgb('#ff7fae'))).toBe('#ff7fae');
  });

  it('tints the ground and water for dusk and night, and keeps the day as the map draws it', () => {
    const day = arenaPlan('lake', 'day', 1);
    const night = arenaPlan('lake', 'night', 1);
    expect(rgbHex(groundColor(day))).toBe(ARENA_SPECS['lake']!.ground);
    expect(groundColor(night)).not.toEqual(groundColor(day));
    expect(waterColor(day)).not.toBeNull();
    expect(waterColor(arenaPlan('forest', 'day', 1))).toBeNull();
    // The night's water leans blue.
    const w = waterColor(night)!;
    expect(w[2]).toBeGreaterThan(w[0]);
  });

  it('puts the sun glow on the key light side of the horizon', () => {
    const sky = skyColors(arenaPlan('meadow', 'dusk', 1));
    const towards = skyAt(sky, 0.05, sky.sunAzimuth);
    const away = skyAt(sky, 0.05, sky.sunAzimuth + Math.PI);
    // Warmer (more red than blue) towards the sun.
    expect(towards[0] - towards[2]).toBeGreaterThan(away[0] - away[2]);
    skyAt(sky, 1, 0).forEach((c, i) => {
      expect(c).toBeCloseTo(sky.zenith[i] ?? -1, 6);
    });
    const sun = sunPlacement(arenaPlan('meadow', 'dusk', 1));
    expect(sun.y).toBeGreaterThan(0);
  });

  it('mottles the ground and darkens its rim', () => {
    const seed = 4;
    const middle = groundShade(0, 0, 0, seed);
    const rim = groundShade(ARENA_STAGE.groundRadius, 0, 1, seed);
    expect(rim).toBeLessThan(middle);
    const a = groundShade(1, 2, 0.1, seed);
    const b = groundShade(5, -3, 0.1, seed);
    expect(a).not.toBe(b);
    expect(a).toBeGreaterThan(0.5);
    expect(b).toBeLessThanOrEqual(1.05);
  });
});
