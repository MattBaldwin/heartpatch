import { readFileSync } from 'node:fs';
import { GAME_DATA, visualRegistry } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { squishyParams } from '../procedural/params.js';
import { ARENA_STAGE } from './arena-config.js';
import { BATTLE_CAMERA, FIGHTER, HOMES } from './battle-config.js';
import {
  arenaReach,
  battleScale,
  CameraDirector,
  frameDistance,
  shakeOffset,
  type CameraShot,
  type FitPoint,
  type Point3,
  type SafeRegion,
} from './camera-director.js';

const homes = { a: HOMES.mine, b: HOMES.theirs } as const;
const safe = { top: 0.12, bottom: 0.65 };
const fit: FitPoint[] = [
  { x: HOMES.mine.x, z: HOMES.mine.z, r: 1.6, h: 3.6 },
  { x: HOMES.theirs.x, z: HOMES.theirs.z, r: 1.6, h: 3.6 },
];
const cue = {
  focus: 'b' as const,
  push: 0.1,
  pushDelay: 0,
  shake: 0.12,
  shakeDelay: 0,
  roll: 0.02,
};

describe('frameDistance', () => {
  it('backs off further on a phone than on a landscape iPad, and keeps the aim at feetY', () => {
    const phone = frameDistance(390 / 844, safe, fit);
    const tablet = frameDistance(1180 / 820, safe, fit);
    expect(phone.distance).toBeGreaterThan(tablet.distance);
    expect(phone.shift).toBeCloseTo(1 - 2 * BATTLE_CAMERA.feetY, 6);
  });

  it('backs off more when the safe region shrinks or a fit point grows', () => {
    const roomy = frameDistance(1, safe, fit).distance;
    const tight = frameDistance(1, { top: 0.25, bottom: 0.65 }, fit).distance;
    expect(tight).toBeGreaterThan(roomy);
    const far = frameDistance(1, safe, [
      ...fit,
      { x: HOMES.theirs.x - 3, z: HOMES.theirs.z, r: 1.6, h: 3.6 },
    ]).distance;
    expect(far).toBeGreaterThanOrEqual(roomy);
  });
});

describe('shakeOffset', () => {
  it('dies away and is nothing before it starts', () => {
    expect(shakeOffset(0.2, -5)).toEqual({ x: 0, y: 0 });
    const early = Math.hypot(shakeOffset(0.2, 20).x, shakeOffset(0.2, 20).y);
    expect(early).toBeGreaterThan(0);
    expect(shakeOffset(0.2, 2000)).toEqual({ x: 0, y: 0 });
  });
});

describe('CameraDirector', () => {
  it('looks at the fight from a low angle, above the ground', () => {
    const cam = new CameraDirector(homes, false);
    const shot = cam.shot(0, 390 / 844, safe, fit);
    expect(shot.position.y).toBeGreaterThan(shot.target.y);
    expect(shot.position.z).toBeLessThan(shot.target.z);
    expect(shot.fov).toBe(BATTLE_CAMERA.fov);
    expect(shot.up).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('leans towards the fighter a step is about and pushes in on a hit, then relaxes', () => {
    const cam = new CameraDirector(homes, false);
    const rest = { ...cam.shot(0, 1, safe, fit).target };
    const restDistance = cam.shot(0, 1, safe, fit).distance;
    cam.cue(cue, 0);
    let shot = cam.shot(16, 1, safe, fit);
    for (let t = 32; t <= 600; t += 16) shot = cam.shot(t, 1, safe, fit);
    expect(shot.target.x).toBeGreaterThan(rest.x);
    expect(shot.distance).toBeLessThan(restDistance);
    expect(cam.moving(600)).toBe(true);
    const pushed = shot.distance;
    for (let t = 616; t <= 4000; t += 16) shot = cam.shot(t, 1, safe, fit);
    expect(shot.distance).toBeGreaterThan(pushed);
    cam.rest();
    for (let t = 4016; t <= 6000; t += 16) shot = cam.shot(t, 1, safe, fit);
    expect(shot.target.x).toBeCloseTo(rest.x, 2);
    expect(cam.moving(6000)).toBe(false);
  });

  it('shakes and rolls on impact, then settles', () => {
    const cam = new CameraDirector(homes, false);
    cam.cue(cue, 1000);
    const shot = cam.shot(1020, 1, safe, fit);
    expect(shot.up.x).not.toBe(0);
    expect(
      Math.abs(shot.target.x - (BATTLE_CAMERA.aim.x + 0)) +
        Math.abs(shot.target.y - BATTLE_CAMERA.aim.y),
    ).toBeGreaterThan(0);
    for (let t = 1040; t <= 3000; t += 16) cam.shot(t, 1, safe, fit);
    expect(cam.shot(3000, 1, safe, fit).up.x).toBeCloseTo(0, 6);
  });

  it('never shakes, rolls or pushes with reduced motion, and leans only a little', () => {
    const cam = new CameraDirector(homes, true);
    const restDistance = cam.shot(0, 1, safe, fit).distance;
    cam.cue(cue, 0);
    const shot = cam.shot(16, 1, safe, fit);
    expect(shot.up).toEqual({ x: 0, y: 1, z: 0 });
    expect(shot.distance).toBe(restDistance);
    expect(shot.target.y).toBe(BATTLE_CAMERA.aim.y);
    expect(shot.target.x - BATTLE_CAMERA.aim.x).toBeLessThan(BATTLE_CAMERA.focusShift);
  });

  it('reuses its shot object (no per-frame garbage)', () => {
    const cam = new CameraDirector(homes, false);
    expect(cam.shot(0, 1, safe, fit)).toBe(cam.shot(16, 1, safe, fit));
  });
});

describe('battleScale', () => {
  it('draws most squishies at the close-up scale and a tall one smaller, still taller', () => {
    const { knee, maxHeight } = FIGHTER.tall;
    expect(battleScale(knee / FIGHTER.scale)).toBe(FIGHTER.scale);
    expect(battleScale(1)).toBe(FIGHTER.scale);
    let last = 0;
    for (let h = 0.5; h <= 8; h += 0.25) {
      const drawn = h * battleScale(h);
      expect(drawn).toBeGreaterThanOrEqual(last - 1e-9);
      expect(drawn).toBeLessThanOrEqual(maxHeight + 1e-9);
      last = drawn;
    }
  });
});

/** Every species as battle draws it (battle-scene.ts `#fighter`), tallest first. */
const registry = visualRegistry(GAME_DATA);
const fighters = GAME_DATA.species
  .map((species) => {
    const params = squishyParams(species, `${species.id}-1`, registry);
    const body = registry.bodies.get(params.body.id);
    const scale = battleScale(params.height);
    const [sx, , sz] = params.body.scale;
    return {
      id: species.id,
      raw: params.height * FIGHTER.scale,
      height: params.height * scale,
      radius: (Math.max((body?.width ?? 1) * sx, (body?.depth ?? 1) * sz) * scale) / 2,
    };
  })
  .sort((a, b) => b.raw - a.raw);

/** The scene's fit points for a fighter standing at home (battle-scene.ts, #142's margins). */
const fitFor = (f: { height: number; radius: number }, home: { x: number; z: number }) => ({
  x: home.x,
  z: home.z,
  r: f.radius * 1.35 + 0.6,
  h: f.height * 1.25 + 0.3,
});

/** Screens and the HUD's safe regions on them (pills under the notch; the sheet's share, battle.css). */
const SCREENS: { name: string; aspect: number; safe: SafeRegion }[] = [
  { name: 'iPhone 15', aspect: 393 / 852, safe: { top: 0.24, bottom: 0.59 } },
  { name: 'iPhone SE', aspect: 375 / 667, safe: { top: 0.25, bottom: 0.54 } },
  { name: '320 px phone', aspect: 320 / 568, safe: { top: 0.25, bottom: 0.48 } },
  { name: 'iPad portrait', aspect: 820 / 1180, safe: { top: 0.1, bottom: 0.63 } },
  // From 900 px wide the sheet is a centred card: the ground shows to the screen's bottom.
  { name: 'iPad Pro portrait', aspect: 1024 / 1366, safe: { top: 0.08, bottom: 0.63, floor: 1 } },
  { name: 'iPad landscape', aspect: 1180 / 820, safe: { top: 0.15, bottom: 0.63, floor: 1 } },
];

/** A world point's place on screen for `shot`: x in NDC, y as a fraction of the height from the top. */
function project(shot: CameraShot, aspect: number, p: Point3): { x: number; y: number } {
  const f = norm(sub(shot.target, shot.position));
  const r = norm(cross(shot.up, f));
  const u = cross(f, r);
  const d = sub(p, shot.position);
  const z = dot(d, f);
  const tan = Math.tan(shot.fov / 2);
  return {
    x: dot(d, r) / (z * tan * aspect),
    y: (1 - (dot(d, u) / (z * tan) + shot.shift)) / 2,
  };
}

/** Where the screen row `y` (fraction from the top) meets the ground at screen edge `x` (NDC). */
function groundAt(shot: CameraShot, aspect: number, x: number, y: number): Point3 {
  const f = norm(sub(shot.target, shot.position));
  const r = norm(cross(shot.up, f));
  const u = cross(f, r);
  const tan = Math.tan(shot.fov / 2);
  const a = x * tan * aspect;
  const b = (1 - 2 * y - shot.shift) * tan;
  const ray = {
    x: f.x + a * r.x + b * u.x,
    y: f.y + a * r.y + b * u.y,
    z: f.z + a * r.z + b * u.z,
  };
  const t = -shot.position.y / ray.y;
  return { x: shot.position.x + t * ray.x, y: 0, z: shot.position.z + t * ray.z };
}

const sub = (a: Point3, b: Point3) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Point3, b: Point3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Point3, b: Point3) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm = (a: Point3) => {
  const l = Math.hypot(a.x, a.y, a.z);
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/**
 * How big fighters must look, as shares of the screen's height (#652): a
 * tall one (above `FIGHTER.tall.knee`) at least `tall`; the small one across
 * from it at least `share` of the size it has against an ordinary (median)
 * squishy, so a big opponent never shrinks it much; nobody under `least`
 * (the smallest species on a 320 px phone, whose headroom is tiny).
 */
const ON_SCREEN = { tall: 0.085, share: 0.75, least: 0.03 };

describe('the sheet the camera frames above', () => {
  it('turns into a centred card from the width the camera expects (battle.css)', () => {
    const css = readFileSync(new URL('./battle.css', import.meta.url), 'utf8');
    const card = new RegExp(
      `@media \\(min-width: ${BATTLE_CAMERA.narrowSheetFrom}px\\) \\{\\s*\\.battle-sheet \\{[^}]*width: \\d+px`,
    );
    expect(css).toMatch(card);
  });
});

describe('framing every species (#652)', () => {
  const smallest = fighters.at(-1)!;
  const median = fighters[Math.floor(fighters.length / 2)]!;

  /** The director's resting shot of `mine` against `theirs`, and how tall each looks. */
  const frameUp = (
    screen: (typeof SCREENS)[number],
    mine: (typeof fighters)[number],
    theirs: (typeof fighters)[number],
  ) => {
    const { aspect, safe } = screen;
    const fit = [fitFor(mine, HOMES.mine), fitFor(theirs, HOMES.theirs)];
    const shot = new CameraDirector({ a: HOMES.mine, b: HOMES.theirs }, true).shot(
      0,
      aspect,
      safe,
      fit,
    );
    const looks = (f: (typeof fighters)[number], home: { x: number; z: number }) => {
      const feet = project(shot, aspect, { x: home.x, y: 0, z: home.z }).y;
      const head = project(shot, aspect, { x: home.x, y: f.height, z: home.z }).y;
      return { feet, head, size: feet - head };
    };
    return {
      fit,
      shot: { ...shot },
      mine: looks(mine, HOMES.mine),
      theirs: looks(theirs, HOMES.theirs),
    };
  };

  it('knows the tallest and smallest squishies in the data', () => {
    expect(fighters.length).toBe(GAME_DATA.species.length);
    expect(fighters[0]!.raw).toBeGreaterThan(FIGHTER.tall.maxHeight);
    expect(smallest.raw).toBeLessThan(FIGHTER.tall.knee);
  });

  for (const screen of SCREENS) {
    it(`keeps the camera over the arena and every fighter big on an ${screen.name}`, () => {
      const { aspect, safe } = screen;
      // Against an ordinary squishy: the size a big opponent mustn't shrink.
      const ordinary = {
        mine: frameUp(screen, smallest, median).mine.size,
        theirs: frameUp(screen, median, smallest).theirs.size,
      };
      for (const big of fighters) {
        for (const [mine, theirs, small] of [
          [big, smallest, 'theirs'],
          [smallest, big, 'mine'],
        ] as const) {
          const label = `${mine.id} vs ${theirs.id}`;
          const framed = frameUp(screen, mine, theirs);
          const frame = frameDistance(aspect, safe, framed.fit);
          // Inside the arena, and never clamped for real squishies: everything fits.
          expect(frame.distance, label).toBeLessThan(BATTLE_CAMERA.maxDistance);
          const floor = safe.floor ?? safe.bottom;
          expect(frame.distance, label).toBeLessThan(arenaReach(aspect, floor, frame.shift));
          // The lowest row of the stage that shows lands on the ground, both ends.
          for (const x of [-1, 1]) {
            const g = groundAt(framed.shot, aspect, x, floor);
            expect(Math.hypot(g.x, g.z), label).toBeLessThan(ARENA_STAGE.groundRadius);
          }
          for (const side of ['mine', 'theirs'] as const) {
            const looks = framed[side];
            // Below the pills, above the sheet.
            expect(looks.head, `${label}: ${side}`).toBeGreaterThan(safe.top);
            expect(looks.feet, `${label}: ${side}`).toBeLessThan(safe.bottom);
            expect(looks.size, `${label}: ${side}`).toBeGreaterThan(ON_SCREEN.least);
          }
          expect(framed[small].size, label).toBeGreaterThan(ON_SCREEN.share * ordinary[small]);
          if (big.raw > FIGHTER.tall.knee) {
            const tall = small === 'mine' ? framed.theirs : framed.mine;
            expect(tall.size, label).toBeGreaterThan(ON_SCREEN.tall);
          }
        }
      }
    });
  }

  it('never backs off past the arena, however big a fit point gets', () => {
    for (const screen of SCREENS) {
      const huge = [{ x: HOMES.mine.x, z: HOMES.mine.z, r: 6, h: 40 }];
      const frame = frameDistance(screen.aspect, screen.safe, huge);
      expect(frame.distance).toBeLessThanOrEqual(BATTLE_CAMERA.maxDistance);
      expect(frame.distance).toBeLessThanOrEqual(
        arenaReach(screen.aspect, screen.safe.floor ?? screen.safe.bottom, frame.shift) + 1e-9,
      );
    }
  });

  it("finds the rim: backing off past the reach shows the ground's edge", () => {
    const { aspect, safe } = SCREENS[1]!;
    const shift = frameDistance(aspect, safe, fit).shift;
    const open = { ...BATTLE_CAMERA, maxDistance: 500 };
    const reach = arenaReach(aspect, safe.bottom, shift, open);
    const at = (d: number) => {
      const back = Math.cos(open.pitch) * d;
      const shot: CameraShot = {
        position: {
          x: open.aim.x - Math.sin(open.yaw) * back,
          y: open.aim.y + Math.sin(open.pitch) * d,
          z: open.aim.z - Math.cos(open.yaw) * back,
        },
        target: open.aim,
        up: { x: 0, y: 1, z: 0 },
        fov: open.fov,
        shift,
        distance: d,
      };
      return Math.max(
        ...[-1, 1].map((x) => {
          const g = groundAt(shot, aspect, x, safe.bottom);
          return Math.hypot(g.x, g.z);
        }),
      );
    };
    expect(at(reach)).toBeCloseTo(ARENA_STAGE.groundRadius - open.rimMargin, 4);
    expect(at(reach + 10)).toBeGreaterThan(ARENA_STAGE.groundRadius - open.rimMargin);
  });
});
