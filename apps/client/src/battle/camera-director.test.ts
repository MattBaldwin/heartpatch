import { GAME_DATA, visualRegistry } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { squishyParams } from '../procedural/params.js';
import { ARENA_MOODS, ARENA_STAGE } from './arena-config.js';
import battleCss from './battle.css?raw';
import { BATTLE_CAMERA, FIGHTER, HOMES, TEAM_ARENA } from './battle-config.js';
import {
  arenaReach,
  battleScale,
  CameraDirector,
  faceDrop,
  fogFor,
  frameDistance,
  shakeOffset,
  type CameraShot,
  type FacePoint,
  type FitPoint,
  type Point3,
  type SafeRegion,
} from './camera-director.js';
import { actPose, FEELING_TRAITS, readyPose, REST, type Act, type Pose } from './choreography.js';
import { faceSpan, posedFace } from './face-span.js';

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

describe('a boss fight on a notched iPhone (#234)', () => {
  // Measured in Chromium at 393×852 with the iPhone's safe-area insets (top 59,
  // bottom 34): Rakelet (Lv 28) against a team of three, at rest.
  const aspect = 393 / 852;
  const team = { ...BATTLE_CAMERA, pitch: TEAM_ARENA.pitch };
  const bossFit: FitPoint[] = [
    { x: -4.3, z: -3.77, r: 2.4, h: 4.27 },
    { x: 0.4, z: -2.6, r: 2.38, h: 4.25 },
    { x: 5.1, z: -1.43, r: 2.4, h: 4.08 },
    { x: -1, z: 9.5, r: 2.57, h: 8.88 },
  ];
  const fighting = { top: 0.378, bottom: 0.529 };
  const result = { top: 0.198, bottom: 0.51 };
  const uncapped = { ...team, maxFitDistance: Infinity };

  it('would have backed the camera out past the sky dome and the fog', () => {
    // The bug: 160 units back, the dome (radius 95) hid the whole fight.
    const before = frameDistance(aspect, fighting, bossFit, uncapped).distance;
    expect(before).toBeGreaterThan(ARENA_STAGE.skyRadius);
  });

  for (const [name, band] of [
    ['fighting', fighting],
    ['result', result],
  ] as const) {
    it(`keeps the camera inside the sky dome and before the fog ends (${name})`, () => {
      const { distance } = frameDistance(aspect, band, bossFit, team);
      expect(distance).toBeLessThanOrEqual(team.maxFitDistance);
      // The camera to the fight's far side (the boss) stays under the dome's radius.
      expect(distance + 10).toBeLessThan(ARENA_STAGE.skyRadius);
      for (const [mood, { fog }] of Object.entries(ARENA_MOODS)) {
        const [, end] = fogFor(fog, distance, [0, 0], team);
        // The ground under the boss, behind the aim, is well short of the fog's end.
        expect(distance + 10, mood).toBeLessThan(end - 20);
      }
    });
  }

  it('still fits a band roomy enough without the cap', () => {
    // The result screen's band asks for less than the cap: nothing changes there.
    const capped = frameDistance(aspect, result, bossFit, team).distance;
    const free = frameDistance(aspect, result, bossFit, uncapped).distance;
    expect(free).toBeLessThan(team.maxFitDistance);
    expect(capped).toBeCloseTo(free, 9);
  });

  it('without the boss face rule, the boss tucks its head under the plate (the #867 baseline)', () => {
    // The #234 hotfix's frame, kept as the baseline #868 improves on: with no
    // face to frame (a 1-v-1, or a boss with no face), at the cap the team
    // stands whole in the stage band but only the boss's feet and legs show.
    // Measured: head ≈ 0.253, feet ≈ 0.397 of the screen height, band
    // 0.378–0.529. The boss-face tests below frame its face first.
    const shot = new CameraDirector({ a: HOMES.mine, b: HOMES.theirs }, true, team).shot(
      0,
      aspect,
      fighting,
      bossFit,
    );
    const [boss, ...friends] = [bossFit[3]!, ...bossFit.slice(0, 3)];
    for (const f of friends) {
      const head = project(shot, aspect, { x: f.x, y: f.h, z: f.z });
      const feet = project(shot, aspect, { x: f.x, y: 0, z: f.z });
      expect(head.y, `head ${String(f.x)}`).toBeGreaterThan(fighting.top);
      expect(feet.y, `feet ${String(f.x)}`).toBeLessThan(fighting.bottom);
    }
    const bossHead = project(shot, aspect, { x: boss.x, y: boss.h, z: boss.z });
    const bossFeet = project(shot, aspect, { x: boss.x, y: 0, z: boss.z });
    expect(bossHead.y).toBeCloseTo(0.253, 2);
    expect(bossFeet.y).toBeCloseTo(0.397, 2);
    // Its feet stand inside the band: the boss is there, not lost in the sky.
    expect(bossFeet.y).toBeGreaterThan(fighting.top);
    expect(bossFeet.y).toBeLessThan(fighting.bottom);
  });

  it('keeps every fighter on screen sideways at the cap', () => {
    const { distance, shift } = frameDistance(aspect, fighting, bossFit, team);
    const shot = new CameraDirector({ a: HOMES.mine, b: HOMES.theirs }, true, team).shot(
      0,
      aspect,
      fighting,
      bossFit,
    );
    expect(shot.distance).toBeCloseTo(distance, 9);
    for (const f of bossFit) {
      const feet = project(shot, aspect, { x: f.x, y: 0, z: f.z });
      expect(Math.abs(feet.x), `${String(f.x)},${String(f.z)}`).toBeLessThan(1);
      expect(feet.y).toBeGreaterThan(0);
      expect(feet.y).toBeLessThan(1);
    }
    expect(shift).toBeCloseTo(1 - 2 * Math.min(team.feetY, fighting.bottom - 0.08), 9);
  });
});

describe('fogFor', () => {
  it("keeps the mood's own fog at the usual framing distance or closer", () => {
    expect(fogFor([25, 85], 30)).toEqual([25, 85]);
    expect(fogFor([25, 85], BATTLE_CAMERA.fogReference)).toEqual([25, 85]);
  });

  it('pushes the fog back as far as the camera sits past the usual distance', () => {
    const out: [number, number] = [0, 0];
    expect(fogFor([28, 90], BATTLE_CAMERA.fogReference + 15, out)).toEqual([43, 105]);
    expect(fogFor([28, 90], BATTLE_CAMERA.fogReference + 15, out)).toBe(out);
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

/**
 * Screens and the HUD's safe regions on them: pills under the notch, the
 * sheet's share (battle.css). `playing` is the lowest row the stage shows
 * while a turn plays and the sheet shrinks to its caption (about 152 px on an
 * iPhone SE, measured; plus the home indicator); on a 320 px phone even an
 * ordinary pair shows past the rim there, as before #652, so it has none.
 * From 900 px wide the sheet is a centred card, so the ground shows to the
 * screen's bottom (`floor: 1`). On a landscape phone the pills and sheet leave
 * the fight a thin band (pill bottoms estimated from the CSS): even ordinary
 * squishies need the camera past the rim, as before #652 (`arena: false`), so
 * there the arena's reach must never pull the camera in on a fighter.
 */
const SCREENS: {
  name: string;
  aspect: number;
  safe: SafeRegion;
  playing?: number;
  arena?: false;
}[] = [
  {
    name: 'iPhone 15',
    aspect: 393 / 852,
    safe: { top: 0.24, bottom: 0.59 },
    playing: 1 - 186 / 852,
  },
  {
    name: 'iPhone SE',
    aspect: 375 / 667,
    safe: { top: 0.25, bottom: 0.54 },
    playing: 1 - 152 / 667,
  },
  {
    name: '320 px phone',
    aspect: 320 / 568,
    safe: { top: 0.25, bottom: 0.48 },
  },
  {
    name: 'iPad portrait',
    aspect: 820 / 1180,
    safe: { top: 0.1, bottom: 0.63 },
    playing: 1 - 152 / 1180,
  },
  {
    name: 'iPad Pro portrait',
    aspect: 1024 / 1366,
    safe: { top: 0.08, bottom: 0.63, floor: 1 },
    playing: 1,
  },
  {
    name: 'iPad landscape',
    aspect: 1180 / 820,
    safe: { top: 0.15, bottom: 0.63, floor: 1 },
    playing: 1,
  },
  {
    name: 'landscape phone',
    aspect: 844 / 390,
    safe: { top: 0.4, bottom: 0.54 },
    playing: 1 - 152 / 390,
    arena: false,
  },
  {
    name: 'small landscape phone',
    aspect: 667 / 375,
    safe: { top: 0.41, bottom: 0.54 },
    playing: 1 - 152 / 375,
    arena: false,
  },
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
    const card = new RegExp(
      `@media \\(min-width: ${BATTLE_CAMERA.narrowSheetFrom}px\\) \\{\\s*\\.battle-sheet \\{[^}]*width: \\d+px`,
    );
    expect(battleCss).toMatch(card);
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
          if (screen.arena === false) {
            // At least as far back as the fighters themselves need (only the box is trimmed).
            const fightersOnly = { ...BATTLE_CAMERA, fitHeight: 0, fitHalfWidth: 0 };
            const need = frameDistance(aspect, safe, framed.fit, fightersOnly).distance;
            expect(frame.distance, label).toBeGreaterThanOrEqual(need - 1e-9);
            continue;
          }
          // The lowest rows of the stage that show land on the ground, both ends:
          // the sheet's top while choosing, its caption's top while a turn plays.
          const floor = safe.floor ?? safe.bottom;
          for (const row of [floor, ...(screen.playing === undefined ? [] : [screen.playing])]) {
            expect(frame.distance, label).toBeLessThan(arenaReach(aspect, row, frame.shift));
            for (const x of [-1, 1]) {
              const g = groundAt(framed.shot, aspect, x, row);
              expect(Math.hypot(g.x, g.z), `${label} (row ${row.toFixed(2)})`).toBeLessThan(
                ARENA_STAGE.groundRadius,
              );
            }
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

  it('keeps the fight box inside the arena but never cuts a fighter (#142)', () => {
    for (const screen of SCREENS.filter((s) => s.arena !== false)) {
      const { aspect, safe } = screen;
      const floor = safe.floor ?? safe.bottom;
      // Nobody to fit: the fight's box alone backs off no further than the arena reaches.
      const empty = frameDistance(aspect, safe, []);
      expect(empty.distance).toBeLessThanOrEqual(arenaReach(aspect, floor, empty.shift) + 1e-9);
      // A giant still fits whole, rim or no rim, up to the sky dome's cap (#234).
      const giant = { x: HOMES.mine.x, z: HOMES.mine.z, r: 6, h: 40 };
      const uncapped = { ...BATTLE_CAMERA, maxFitDistance: Infinity };
      const frame = frameDistance(aspect, safe, [giant], uncapped);
      const shot = new CameraDirector({ a: HOMES.mine, b: HOMES.theirs }, true, uncapped).shot(
        0,
        aspect,
        safe,
        [giant],
      );
      const head = project(shot, aspect, { x: giant.x, y: giant.h, z: giant.z });
      expect(frame.distance).toBeGreaterThan(arenaReach(aspect, floor, frame.shift));
      expect(head.y, screen.name).toBeGreaterThan(safe.top - 1e-6);
      // Past the cap the camera stops: an empty sky is worse than a tucked-in head.
      if (frame.distance > BATTLE_CAMERA.maxFitDistance) {
        expect(frameDistance(aspect, safe, [giant]).distance).toBe(BATTLE_CAMERA.maxFitDistance);
      }
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

describe('a boss fight frames the boss face first (#868)', () => {
  // The #234 fixture: Rakelet (Lv 28) against three, measured at 393×852.
  const aspect = 393 / 852;
  const team = { ...BATTLE_CAMERA, pitch: TEAM_ARENA.pitch };
  const posts = TEAM_ARENA.posts[3];
  const bossHome = TEAM_ARENA.boss;
  const bossFit: FitPoint = { x: bossHome.x, z: bossHome.z, r: 2.57, h: 8.88 };
  const friendsFit: FitPoint[] = posts.map((p) => ({ x: p.x, z: p.z, r: 2.4, h: 4.2 }));
  const fit = [...friendsFit, bossFit];
  // The boss's drawn height, back out of its fit point (battle-scene.ts: h = height · 1.25 + 0.3).
  const bossHeight = (bossFit.h - 0.3) / 1.25;
  // It faces the row's middle squishy (battle-scene.ts: the boss rig looks at the lead).
  const lead = posts[1]!;
  const len = Math.hypot(lead.x - bossHome.x, lead.z - bossHome.z);
  const fx = (lead.x - bossHome.x) / len;
  const fz = (lead.z - bossHome.z) / len;

  const BANDS: { name: string; aspect: number; safe: SafeRegion }[] = [
    // Measured (#867): a notched iPhone's fight and result bands.
    { name: 'notched iPhone fight', aspect, safe: { top: 0.378, bottom: 0.529 } },
    { name: 'notched iPhone result', aspect, safe: { top: 0.198, bottom: 0.51 } },
    // An iPad portrait's fight band (the boss plate and team plates are shorter on a tall screen).
    { name: 'iPad portrait fight', aspect: 820 / 1180, safe: { top: 0.2, bottom: 0.63 } },
  ];

  // Every kind's eyes and mouth (the boss's species is server data, so all of them stand in).
  const faces = GAME_DATA.species.flatMap((species) => {
    const span = faceSpan(squishyParams(species, `${species.id}-1`, registry), registry);
    return span
      ? [{ id: species.id, low: span.low * bossHeight, high: span.high * bossHeight }]
      : [];
  });

  // The boss's poses, every 1/24 of each act a boss plays (a dash's windup, the
  // power-up, getting bonked, its victory hop as the taunt, a cast), at full motion.
  const ACTS = ['dash', 'power-up', 'knockback', 'victory', 'cast'] as const;
  const feelings = Object.keys(FEELING_TRAITS) as (keyof typeof FEELING_TRAITS)[];
  const poses: { name: string; pose: Pose }[] = [{ name: 'idle', pose: REST }];
  for (const feeling of feelings) {
    for (let t = 0; t < 4000; t += 250) {
      poses.push({ name: `idle ${feeling} ${String(t)}`, pose: readyPose(t, 0, feeling, false) });
    }
    for (const kind of ACTS) {
      const act: Act = {
        kind,
        start: 0,
        ms: 1000,
        from: REST,
        reach: 6,
        strength: 1.4,
        feeling,
        reduced: false,
      };
      for (let i = 0; i <= 24; i++) {
        poses.push({
          name: `${kind} ${feeling} ${String(i)}/24`,
          pose: actPose(act, (i / 24) * 1000),
        });
      }
    }
  }

  it('measures where faces sit: between about a third and the top of a squishy', () => {
    expect(faces.length).toBeGreaterThan(100);
    for (const f of faces) {
      expect(f.low, f.id).toBeGreaterThan(0.2 * bossHeight);
      expect(f.high, f.id).toBeLessThanOrEqual(bossHeight);
      expect(f.high, f.id).toBeGreaterThan(f.low);
    }
  });

  for (const band of BANDS) {
    it(`keeps every kind's eyes and mouth inside the ${band.name} band, in every pose`, () => {
      const face: FacePoint = { x: 0, z: 0, low: 0, high: 0 };
      // Reduced motion: no easing, push or shake, so each shot stands on its own frame.
      const director = new CameraDirector(homes, true, team);
      for (const f of faces) {
        // The worst pose for this face, asserted once (the pose sweep is ~850 frames).
        let top = { y: Infinity, name: '' };
        let bottom = { y: -Infinity, name: '' };
        for (const { name, pose } of poses) {
          posedFace(face, bossHome, fx, fz, pose, f);
          const shot = director.shot(0, band.aspect, band.safe, fit, face);
          const t = project(shot, band.aspect, { x: face.x, y: face.high, z: face.z }).y;
          const b = project(shot, band.aspect, { x: face.x, y: face.low, z: face.z }).y;
          if (t < top.y) top = { y: t, name };
          if (b > bottom.y) bottom = { y: b, name };
        }
        expect(top.y, `${f.id} ${top.name}`).toBeGreaterThanOrEqual(band.safe.top - 1e-9);
        expect(bottom.y, `${f.id} ${bottom.name}`).toBeLessThanOrEqual(band.safe.bottom + 1e-9);
      }
      // The dev hook reports the face where the shot put it.
      posedFace(face, bossHome, fx, fz, REST, faces[0]!);
      const shot = director.shot(0, band.aspect, band.safe, fit, face);
      const t = project(shot, band.aspect, { x: face.x, y: face.high, z: face.z }).y;
      expect(director.face.high).toBeCloseTo(t, 9);
    });
  }

  it('keeps the #867 cap and fog: only the lens shift moves', () => {
    for (const band of BANDS) {
      const face = posedFace({ x: 0, z: 0, low: 0, high: 0 }, bossHome, fx, fz, REST, faces[0]!);
      const plain = new CameraDirector(homes, true, team).shot(0, band.aspect, band.safe, fit);
      const before = { ...plain, position: { ...plain.position } };
      const framed = new CameraDirector(homes, true, team).shot(
        0,
        band.aspect,
        band.safe,
        fit,
        face,
      );
      expect(framed.distance).toBeCloseTo(before.distance, 9);
      expect(framed.distance).toBeLessThanOrEqual(team.maxFitDistance);
      expect(framed.position.y).toBeCloseTo(before.position.y, 9);
      expect(framed.shift).toBeLessThanOrEqual(before.shift + 1e-12);
    }
  });

  it('on the notched fight band the team still shows: heads in the band, only feet tucked under the cards', () => {
    const band = BANDS[0]!;
    const drakeberry = faces.find((f) => f.id === 'drakeberry') ?? faces[0]!;
    const face = posedFace({ x: 0, z: 0, low: 0, high: 0 }, bossHome, fx, fz, REST, drakeberry);
    const shot = new CameraDirector(homes, true, team).shot(0, band.aspect, band.safe, fit, face);
    for (const p of posts) {
      // A friend's head (its drawn height, without the fit margin) is in the band.
      const head = project(shot, band.aspect, { x: p.x, y: (4.2 - 0.3) / 1.25, z: p.z }).y;
      expect(head, String(p.x)).toBeGreaterThan(band.safe.top);
      expect(head, String(p.x)).toBeLessThan(band.safe.bottom);
    }
  });

  it('leaves the iPad and the result screen as they were (the face already fits)', () => {
    for (const band of BANDS.slice(1)) {
      const face = posedFace({ x: 0, z: 0, low: 0, high: 0 }, bossHome, fx, fz, REST, faces[0]!);
      const plain = new CameraDirector(homes, true, team).shot(0, band.aspect, band.safe, fit);
      const plainShift = plain.shift;
      const framed = new CameraDirector(homes, true, team).shot(
        0,
        band.aspect,
        band.safe,
        fit,
        face,
      );
      expect(framed.shift, band.name).toBeCloseTo(plainShift, 9);
    }
  });

  it('eases the slide at full motion, and no act lifts the eyes under the plate', () => {
    const band = BANDS[0]!;
    const face: FacePoint = { x: 0, z: 0, low: 0, high: 0 };
    // The highest-set faces rise out of the band first.
    const high = [...faces].sort((a, b) => b.high - a.high).slice(0, 3);
    for (const f of high) {
      for (const feeling of feelings) {
        for (const kind of ACTS) {
          for (const ms of [500, 1000, 1600]) {
            const director = new CameraDirector(homes, false, team);
            const act: Act = {
              kind,
              start: 1000,
              ms,
              from: REST,
              reach: 6,
              strength: 1,
              feeling,
              reduced: false,
            };
            // Settle at rest for a second, then the act at 60 fps, and a beat after.
            for (let now = 0; now <= 1000 + ms + 500; now += 1000 / 60) {
              posedFace(face, bossHome, fx, fz, actPose(now < 1000 ? null : act, now), f);
              const shot = director.shot(now, band.aspect, band.safe, fit, face);
              if (now < 900) continue;
              const top = project(shot, band.aspect, { x: face.x, y: face.high, z: face.z }).y;
              expect(
                top,
                `${f.id} ${kind} ${feeling} ${String(ms)} @${now.toFixed(0)}`,
              ).toBeGreaterThanOrEqual(band.safe.top - 1e-9);
            }
          }
        }
      }
    }
  });
});

describe("a boss fight keeps the team's eyes above the team cards (#868)", () => {
  const aspect = 393 / 852;
  const team = { ...BATTLE_CAMERA, pitch: TEAM_ARENA.pitch };
  const posts = TEAM_ARENA.posts[3];
  const boss = TEAM_ARENA.boss;
  const fit: FitPoint[] = [
    ...posts.map((p) => ({ x: p.x, z: p.z, r: 2.4, h: 4.2 })),
    { x: boss.x, z: boss.z, r: 2.57, h: 8.88 },
  ];
  const band = { top: 0.378, bottom: 0.529 };
  const bossFace = (low: number, high: number): FacePoint => ({ x: boss.x, z: boss.z, low, high });
  const row = (low: number, high: number): FacePoint[] =>
    posts.map((p) => ({ x: p.x, z: p.z, low, high }));
  const at = (shot: CameraShot, p: FacePoint) => ({
    top: project(shot, aspect, { x: p.x, y: p.high, z: p.z }).y,
    bottom: project(shot, aspect, { x: p.x, y: p.low, z: p.z }).y,
  });

  it("stops the slide at the team's eye line, the boss keeping its eyes in the band", () => {
    // A small team (faces 2.2–2.9 up) and Rakelet's face (0.64–0.90 of 6.86).
    const friends = row(2.2, 2.9);
    const face = bossFace(4.4, 6.18);
    const free = new CameraDirector(homes, true, team).shot(0, aspect, band, fit, face);
    const freeLow = Math.max(...friends.map((f) => at(free, f).bottom));
    // Without the team the slide would push their eyes under the cards.
    expect(freeLow).toBeGreaterThan(band.bottom - team.faceMargin);
    const director = new CameraDirector(homes, true, team);
    const shot = director.shot(0, aspect, band, fit, face, friends);
    for (const f of friends) {
      expect(at(shot, f).bottom).toBeLessThanOrEqual(band.bottom - team.faceMargin + 1e-9);
    }
    expect(at(shot, face).top).toBeGreaterThanOrEqual(band.top - 1e-9);
    expect(director.team).toHaveLength(3);
    expect(director.team[0]!.low).toBeCloseTo(at(shot, friends[0]!).bottom, 9);
  });

  it("gives up the boss's margin, never its eyes, when both can't fit", () => {
    // A team so low on screen that any slide hides it: the boss still gets its eyes in.
    const friends = row(0.05, 0.1);
    const face = bossFace(5.6, 6.6);
    const shot = new CameraDirector(homes, true, team).shot(0, aspect, band, fit, face, friends);
    expect(at(shot, face).top).toBeCloseTo(band.top, 9);
  });

  it('leaves a team the slide does not reach alone, and a face behind the camera unframed', () => {
    const plain = new CameraDirector(homes, true, team).shot(0, aspect, band, fit);
    const shift = plain.shift;
    const behind = { x: 0, z: -500, low: 1, high: 2 };
    const director = new CameraDirector(homes, true, team);
    const shot = director.shot(0, aspect, band, fit, behind, row(2.2, 2.9));
    expect(shot.shift).toBeCloseTo(shift, 9);
    expect(Number.isFinite(shot.shift)).toBe(true);
  });
});

describe('faceDrop', () => {
  const band = { top: 0.4, bottom: 0.5 };
  it('needs nothing when the face is inside the band', () => {
    expect(faceDrop(0.42, 0.47, band, 0.01)).toBe(0);
  });
  it('slides down until the top of the face is the margin under the band top', () => {
    expect(faceDrop(0.3, 0.35, band, 0.01)).toBeCloseTo(0.11, 9);
  });
  it('keeps the eyes (the top) when the face is taller than the band', () => {
    expect(faceDrop(0.3, 0.55, band, 0.01)).toBeCloseTo(0.11, 9);
  });
  it('slides up when the face sits under the band', () => {
    expect(faceDrop(0.47, 0.53, band, 0.01)).toBeCloseTo(-0.04, 9);
  });
});
