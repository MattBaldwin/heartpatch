import { GAME_DATA, visualRegistry } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { squishyParams } from '../procedural/params.js';
import { ARENA_MOODS, ARENA_STAGE } from './arena-config.js';
import battleCss from './battle.css?raw';
import { BATTLE_CAMERA, BOSS_CARDS, FIGHTER, HOMES, TEAM_ARENA } from './battle-config.js';
import {
  arenaReach,
  battleScale,
  CameraDirector,
  cameraFor,
  clearRise,
  faceDrop,
  fogFor,
  frameDistance,
  holdDrop,
  rollReach,
  shakeOffset,
  shortBand,
  slideWant,
  type CameraShot,
  type FacePoint,
  type FitPoint,
  type Point3,
  type SafeRegion,
} from './camera-director.js';
import { actPose, FEELING_TRAITS, readyPose, REST, type Act, type Pose } from './choreography.js';
import { faceSpan, posedFace, topSpan } from './face-span.js';

const homes = { a: HOMES.mine, b: HOMES.theirs } as const;
/** The team fight's camera from #234 to #190 PR 1: the 1-v-1's, tilted down 21°. */
const TEAM_CAMERA_867 = { ...BATTLE_CAMERA, pitch: (21 * Math.PI) / 180 };
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
  // The team fight's camera before the boss profile (#190 PR 2): the #867 cap's own fixture.
  const team = TEAM_CAMERA_867;
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

describe('rollReach (#190 PR 6b review)', () => {
  it("never widens a standing fighter's fit for its idle sway, so a 1-v-1 phone camera holds still", () => {
    const height = 2.7;
    let swayed = 0;
    for (const feeling of Object.keys(FEELING_TRAITS) as (keyof typeof FEELING_TRAITS)[]) {
      const distances = new Set<number>();
      let rolled = 0;
      for (let now = 0; now <= 6000; now += 1000 / 60) {
        const pose = readyPose(now, 0.4, feeling, false);
        rolled = Math.max(rolled, Math.abs(pose.roll));
        const idle = fit.map((f) => ({
          ...f,
          r: f.r + rollReach(pose.roll, height, pose.scale, false),
        }));
        distances.add(frameDistance(390 / 844, safe, idle).distance);
      }
      expect(distances.size, feeling).toBe(1);
      swayed = Math.max(swayed, rolled);
    }
    // The sway does roll (cozy about 0.1 rad), so widening on every roll would pump the camera.
    expect(swayed).toBeGreaterThan(0.05);
  });

  it("widens a fighter rolled over by an act by its height's sideways sweep", () => {
    expect(rollReach(Math.PI / 2, 2.7, 1, true)).toBeCloseTo(2.7, 9);
    expect(rollReach(-Math.PI / 2, 2.7, 0.5, true)).toBeCloseTo(1.35, 9);
    expect(rollReach(Math.PI / 2, 2.7, 1, false)).toBe(0);
    expect(rollReach(Math.PI / 2, 2.7, -0.2, true)).toBe(0);
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
  const team = cameraFor(true);
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
    // The phone-first boss HUD (#190 PR 1, M0-measured): at rest and with the picker risen.
    { name: 'boss HUD at rest', aspect, safe: { top: 0.142, bottom: 0.876 } },
    { name: 'boss HUD risen', aspect, safe: { top: 0.142, bottom: 0.62 } },
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

  it('on the notched fight band the team still shows: heads in the band, only feet tucked under the chips', () => {
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
    for (const band of BANDS.slice(1, 3)) {
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

describe("a boss fight keeps the team's eyes above the team chips (#868, #190)", () => {
  const aspect = 393 / 852;
  // The slide's rules on the old short band, with the camera they were
  // measured with: the safety net's own fixture. The boss profile's faces are
  // swept on every band above (#190 PR 2).
  const team = TEAM_CAMERA_867;
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
    // Without the team the slide would push their eyes under the chips.
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

  // The round-2 capture's windup (#868): on the old short band the risen boss
  // and the team couldn't share it, so the floor beat the cap.
  const risen = bossFace(5.6, 6.6);
  const low = row(1.0, 1.6);

  it('on a short band the boss keeps its eyes and the team tucks under (the round-2 case)', () => {
    const shot = new CameraDirector(homes, true, team).shot(0, aspect, band, fit, risen, low);
    expect(at(shot, risen).top).toBeGreaterThanOrEqual(band.top - 1e-9);
    const lowest = Math.max(...low.map((f) => at(shot, f).bottom));
    expect(lowest).toBeGreaterThan(band.bottom);
  });

  it('does not chase a boss turned away: holds the last target and reports no face', () => {
    const director = new CameraDirector(homes, true, team);
    const facing = director.shot(0, aspect, band, fit, risen, low);
    const held = facing.shift;
    expect(Number.isNaN(director.face.high)).toBe(false);
    // The same boss twirled away (a taunt at −0.657), standing much higher.
    const away = { ...bossFace(7.5, 8.5), facing: -0.657 };
    const shot = director.shot(16, aspect, band, fit, away, low);
    expect(shot.shift).toBeCloseTo(held, 9);
    expect(Number.isNaN(director.face.high)).toBe(true);
    expect(Number.isNaN(director.face.low)).toBe(true);
    // Just above the threshold it frames the face again.
    const back = { ...risen, facing: team.faceFacingMin + 0.01 };
    director.shot(32, aspect, band, fit, back, low);
    expect(Number.isNaN(director.face.high)).toBe(false);
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

describe('the slide precedence (#868)', () => {
  it('face, then the team cap, then the boss floor (19a0d8c)', () => {
    // The cap stops a slide the team can't take…
    expect(slideWant(0.1, 0.02, 0.05)).toBeCloseTo(0.05, 9);
    // …unless the boss's eyes would stay under the plate: the floor wins.
    expect(slideWant(0.1, 0.08, 0.05)).toBeCloseTo(0.08, 9);
    // No room at all reads as none.
    expect(slideWant(0.1, -0.01, -0.03)).toBe(0);
    // A face that needs no slide down needs no rules.
    expect(slideWant(0, 0.08, 0.05)).toBe(0);
    expect(slideWant(-0.04, 0.08, 0.05)).toBeCloseTo(-0.04, 9);
  });

  it('matches the 19a0d8c rule everywhere', () => {
    const old = (face: number, floor: number, cap: number) =>
      face > 0 ? Math.max(Math.min(face, Math.max(0, cap)), floor) : face;
    for (let face = -0.1; face <= 0.2; face += 0.025) {
      for (let floor = -0.1; floor <= 0.2; floor += 0.025) {
        for (let cap = -0.1; cap <= 0.2; cap += 0.025) {
          expect(slideWant(face, floor, cap)).toBe(old(face, floor, cap));
        }
      }
    }
  });

  it('the rising-face hold keeps the eyes under the strip', () => {
    expect(holdDrop(0.02, 0.06)).toBeCloseTo(0.06, 9);
    expect(holdDrop(0.08, 0.06)).toBeCloseTo(0.08, 9);
    // A face inside the band holds nothing.
    expect(holdDrop(0.02, -0.01)).toBeCloseTo(0.02, 9);
  });

  it('calls the notched iPhone fight band short, never the iPad or the result band', () => {
    expect(shortBand({ top: 0.378, bottom: 0.529 })).toBe(true);
    expect(shortBand({ top: 0.203, bottom: 0.586 })).toBe(false);
    expect(shortBand({ top: 0.198, bottom: 0.509 })).toBe(false);
    expect(BOSS_CARDS.shortBand).toBeGreaterThan(0.529 - 0.378);
    // 393x852 without the notch's insets (WebKit in e2e can't emulate them) is short too.
    expect(BOSS_CARDS.shortBand - 0.2532).toBeGreaterThan(0.02);
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

describe('the boss camera: a low hero shot (#190 PR 2)', () => {
  const boss = cameraFor(true);
  const aspect = 393 / 852;
  const posts = TEAM_ARENA.posts[3];
  const bossHome = TEAM_ARENA.boss;
  // The stage bands of the phone-first boss HUD (#190 PR 1, captures pr1-f48d8ca
  // and pr1b-d6e0c66): a notched iPhone at rest and risen; the WebKit e2e's
  // 393×852 with no insets; an iPad portrait at rest (estimated from the CSS).
  const BANDS: { name: string; aspect: number; safe: SafeRegion }[] = [
    { name: 'notched iPhone at rest', aspect, safe: { top: 0.142, bottom: 0.876 } },
    { name: 'iPhone with no insets at rest', aspect, safe: { top: 0.073, bottom: 0.915 } },
    { name: 'notched iPhone risen', aspect, safe: { top: 0.142, bottom: 0.61 } },
    { name: 'iPad portrait at rest', aspect: 820 / 1180, safe: { top: 0.09, bottom: 0.9 } },
  ];
  const rest = BANDS[0]!;
  // Teams of the smallest, ordinary and tallest kinds; the boss is drawn
  // `TEAM_ARENA.bossScale` × the team's mean height (battle-scene.ts
  // `#bossScale`), so its size follows the team, whichever boss it is. The
  // #234 fixture (Rakelet against three, 6.86 tall) is the fourth.
  // #874 C6: pinned to the pre-#874 median kind so new content can't move the guard.
  const median = fighters.find((f) => f.id === 'wickwhisker')!;
  const TEAMS = [
    { name: 'small team', friends: fighters.slice(-3) },
    { name: 'ordinary team', friends: [median, median, median] },
    { name: 'tall team', friends: fighters.slice(0, 3) },
  ].map(({ name, friends }) => {
    const mean = friends.reduce((a, f) => a + f.height, 0) / friends.length;
    return { name, friends, bossHeight: mean * TEAM_ARENA.bossScale };
  });
  const FIGHTS = [
    ...TEAMS,
    { name: 'Rakelet (#234)', friends: [median, median, median], bossHeight: 6.86 },
  ].map((t) => ({
    ...t,
    fit: [
      ...t.friends.map((f, i) => fitFor(f, posts[i]!)),
      {
        x: bossHome.x,
        z: bossHome.z,
        r: 2.57 * (t.bossHeight / 6.86),
        h: t.bossHeight * 1.25 + 0.3,
      },
    ],
  }));
  const fight = FIGHTS[3]!;
  // Its face (the highest-set and lowest-set kinds), looking at the row's middle.
  const spans = GAME_DATA.species
    .map((s) => faceSpan(squishyParams(s, `${s.id}-1`, registry), registry))
    .filter((s) => s !== null);
  const highest = spans.reduce((a, s) => (s.high > a.high ? s : a));
  const lowest = spans.reduce((a, s) => (s.low < a.low ? s : a));
  const lead = posts[1]!;
  const len = Math.hypot(lead.x - bossHome.x, lead.z - bossHome.z);
  const look = { x: (lead.x - bossHome.x) / len, z: (lead.z - bossHome.z) / len };
  const bossFace = (span: { low: number; high: number }, height: number): FacePoint =>
    posedFace({ x: 0, z: 0, low: 0, high: 0 }, bossHome, look.x, look.z, REST, {
      low: span.low * height,
      high: span.high * height,
    });
  // The team's eyes and mouths: every kind's span, at each friend's height.
  const teamFaces = (friends: readonly { height: number }[]): FacePoint[] =>
    friends.map((f, i) => ({
      x: posts[i]!.x,
      z: posts[i]!.z,
      low: Math.min(...spans.map((s) => s.low)) * f.height,
      high: Math.max(...spans.map((s) => s.high)) * f.height,
    }));

  it('applies only with a boss: the 1-v-1 camera is BATTLE_CAMERA, its numbers as they were', () => {
    expect(cameraFor(false)).toBe(BATTLE_CAMERA);
    // The 1-v-1's framing numbers, pinned (the boss profile must never leak into them).
    expect(BATTLE_CAMERA.pitch).toBeCloseTo((11 * Math.PI) / 180, 12);
    expect(BATTLE_CAMERA.aim).toEqual({ x: 0.35, y: 0.1, z: 0.5 });
    expect(BATTLE_CAMERA.feetY).toBe(0.56);
    expect(BATTLE_CAMERA.fitHeight).toBe(3.6);
    expect(BATTLE_CAMERA.feetRoom).toBe(0.08);
    expect(BATTLE_CAMERA.fitFrom).toBe(0);
    expect(BATTLE_CAMERA.boss.fitFrom).toBe(BATTLE_CAMERA.boss.aim.y);
    // The fog only moves back past the reference, never in.
    expect(fogFor([28, 90], 30)).toEqual([28, 90]);
    // The boss fight's camera differs from it in the profile's keys only.
    const changed = Object.keys(boss)
      .filter((k) => k !== 'boss')
      .filter(
        (k) =>
          JSON.stringify(boss[k as keyof typeof boss]) !==
          JSON.stringify(BATTLE_CAMERA[k as keyof typeof BATTLE_CAMERA]),
      )
      .sort();
    expect(changed).toEqual([
      'aim',
      'feetRoom',
      'feetY',
      'fitFrom',
      'fitHeight',
      'focusShift',
      'mouthClear',
      'pitch',
      'riseMax',
      'sideKeep',
    ]);
    // The 1-v-1 never rises to clear a mouth (#190 PR 6b).
    expect(BATTLE_CAMERA.riseMax).toBe(0);
    expect(boss.pitch).toBeCloseTo((6.5 * Math.PI) / 180, 12);
  });

  for (const f of FIGHTS) {
    it(`fits inside the fog and the dome on every band (${f.name})`, () => {
      for (const band of BANDS) {
        const { distance } = frameDistance(band.aspect, band.safe, f.fit, boss);
        // The row's width sets it on a phone (35–55): never further back than the
        // team camera before it, and well under the cap.
        const was = frameDistance(band.aspect, band.safe, f.fit, TEAM_CAMERA_867).distance;
        expect(distance, band.name).toBeLessThanOrEqual(was + 1e-9);
        expect(distance, band.name).toBeLessThan(boss.maxFitDistance - 10);
        expect(distance + 10, band.name).toBeLessThan(ARENA_STAGE.skyRadius);
        for (const [mood, { fog }] of Object.entries(ARENA_MOODS)) {
          const [, end] = fogFor(fog, distance, [0, 0], boss);
          expect(end, `${band.name} ${mood}`).toBeGreaterThanOrEqual(distance);
          // The boss's ground, behind the aim, is well short of the fog's end.
          expect(distance + 10, `${band.name} ${mood}`).toBeLessThan(end - 20);
        }
      }
    });
  }

  it("keeps the ground's far rim as fogged as the team camera did, and the boss no hazier", () => {
    // Babylon's linear fog by distance from the camera (fogStart → fogEnd).
    const fogAt = (shot: CameraShot, p: Point3, [start, end]: readonly [number, number]) =>
      Math.min(
        1,
        Math.max(
          0,
          (Math.hypot(p.x - shot.position.x, p.y - shot.position.y, p.z - shot.position.z) -
            start) /
            (end - start),
        ),
      );
    const farRim = (shot: CameraShot): Point3 => {
      const f = norm({
        x: shot.target.x - shot.position.x,
        y: 0,
        z: shot.target.z - shot.position.z,
      });
      return { x: f.x * ARENA_STAGE.groundRadius, y: 0, z: f.z * ARENA_STAGE.groundRadius };
    };
    for (const band of BANDS) {
      const low = new CameraDirector(homes, true, boss).shot(0, band.aspect, band.safe, fight.fit);
      const was = new CameraDirector(homes, true, TEAM_CAMERA_867).shot(
        0,
        band.aspect,
        band.safe,
        fight.fit,
      );
      for (const [mood, { fog }] of Object.entries(ARENA_MOODS)) {
        const lowFog = fogFor(fog, low.distance, [0, 0], boss);
        const wasFog = fogFor(fog, was.distance, [0, 0], TEAM_CAMERA_867);
        const at = `${band.name} ${mood}`;
        // Measured: phones 0.79 / 0.86 (was 0.76 / 0.84); the iPad, closer, 0.56 (was 0.60).
        const rim = fogAt(low, farRim(low), lowFog);
        expect(rim, at).toBeGreaterThanOrEqual(fogAt(was, farRim(was), wasFog) - 0.05);
        expect(rim, at).toBeGreaterThan(0.55);
        const feet = { x: bossHome.x, y: 0, z: bossHome.z };
        expect(fogAt(low, feet, lowFog), at).toBeLessThanOrEqual(fogAt(was, feet, wasFog) + 0.05);
      }
    }
  });

  for (const f of FIGHTS.slice(0, 3)) {
    it(`frames the whole team on a 393×852 phone: no friend clipped, eyes in (${f.name})`, () => {
      for (const band of BANDS.slice(0, 3)) {
        const director = new CameraDirector(homes, true, boss);
        const team = teamFaces(f.friends);
        const shot = director.shot(
          0,
          band.aspect,
          band.safe,
          f.fit,
          bossFace(highest, f.bossHeight),
          team,
        );
        f.friends.forEach((friend, i) => {
          const p = posts[i]!;
          const at = `${band.name} ${friend.id} at ${String(p.x)}`;
          // Its body, side to side, inside the screen (M0: the end friends were cut off).
          for (const side of [-1, 1]) {
            const edge = project(shot, band.aspect, {
              x: p.x + side * friend.radius,
              y: friend.height / 2,
              z: p.z,
            });
            expect(Math.abs(edge.x), at).toBeLessThan(0.97);
          }
          // Its eyes and mouth, with a margin at the sides and inside the band.
          const face = team[i]!;
          for (const y of [face.low, face.high]) {
            const e = project(shot, band.aspect, { x: face.x, y, z: face.z });
            expect(Math.abs(e.x), at).toBeLessThan(0.9);
            // At rest with the margin; risen (picking, the shorter band) inside it.
            const margin = band.safe.bottom < 0.7 ? 0 : boss.faceMargin;
            expect(e.y, at).toBeGreaterThanOrEqual(band.safe.top + margin);
            expect(e.y, at).toBeLessThanOrEqual(band.safe.bottom - margin);
          }
        });
        // The picker leans towards each friend in turn (full motion): every body stays on screen.
        posts.slice(0, f.friends.length).forEach((lean, l) => {
          const leaning = new CameraDirector(homes, false, boss);
          leaning.lean(lean);
          let held = leaning.shot(
            0,
            band.aspect,
            band.safe,
            f.fit,
            bossFace(highest, f.bossHeight),
            team,
          );
          for (let t = 1000 / 60; t <= 3000; t += 1000 / 60) {
            held = leaning.shot(
              t,
              band.aspect,
              band.safe,
              f.fit,
              bossFace(highest, f.bossHeight),
              team,
            );
          }
          f.friends.forEach((friend, i) => {
            const p = posts[i]!;
            for (const side of [-1, 1]) {
              const edge = project(held, band.aspect, {
                x: p.x + side * friend.radius,
                y: friend.height / 2,
                z: p.z,
              });
              expect(
                Math.abs(edge.x),
                `${band.name} leaning to ${String(l)}, ${friend.id}`,
              ).toBeLessThan(0.97);
            }
          });
        });
      }
    });
  }

  it("on an iPad (1024×1366) the team's bodies stand over the picker card, at rest and leaning", () => {
    // The picker card's band, measured (captures pr2-8b41f85: band 0.045–0.654,
    // the card's top 0.660, the screen's bottom corners showing beside it).
    // At 8b41f85 the near row's front edges sat ~0.07 under it: only heads showed.
    const ipad = { top: 0.045, bottom: 0.654, floor: 1 };
    const wide = 1024 / 1366;
    for (const f of FIGHTS) {
      const team = teamFaces(f.friends).map((t, i) => ({ ...t, r: f.friends[i]!.radius }));
      for (const lean of [null, ...posts.slice(0, f.friends.length)]) {
        const director = new CameraDirector(homes, false, boss);
        if (lean) director.lean(lean);
        let shot = director.shot(0, wide, ipad, f.fit, bossFace(highest, f.bossHeight), team);
        for (let t = 1000 / 60; t <= 3000; t += 1000 / 60) {
          shot = director.shot(t, wide, ipad, f.fit, bossFace(highest, f.bossHeight), team);
        }
        const at = `${f.name}, ${lean ? `leaning to ${String(lean.x)}` : 'rest'}`;
        f.friends.forEach((friend, i) => {
          const p = posts[i]!;
          // The front edge on the ground, towards the camera: the lowest row the body draws.
          const cx = shot.position.x - p.x;
          const cz = shot.position.z - p.z;
          const len = Math.hypot(cx, cz);
          const front = project(shot, wide, {
            x: p.x + (cx / len) * friend.radius,
            y: 0,
            z: p.z + (cz / len) * friend.radius,
          });
          expect(front.y, `${at}, ${friend.id}`).toBeLessThanOrEqual(ipad.bottom + 1e-6);
        });
        expect(director.feet, at).toBeLessThanOrEqual(ipad.bottom + 1e-6);
        // The boss's eyes stay under the strip, and the team still stands near the floor.
        expect(director.face.high, at).toBeGreaterThanOrEqual(ipad.top);
        expect(ipad.bottom - director.feet, at).toBeLessThan(0.15);
      }
    }
  });

  it('sits the fight low in the band: the team just over the handle, the boss towering behind', () => {
    const shot = new CameraDirector(homes, true, boss).shot(0, rest.aspect, rest.safe, fight.fit);
    const was = new CameraDirector(homes, true, TEAM_CAMERA_867).shot(
      0,
      rest.aspect,
      rest.safe,
      fight.fit,
    );
    const feet = (s: CameraShot) =>
      Math.max(...posts.map((p) => project(s, rest.aspect, { x: p.x, y: 0, z: p.z }).y));
    // M0: empty floor under the team (0.28 of the screen); now about 0.11.
    expect(rest.safe.bottom - feet(was)).toBeGreaterThan(0.25);
    expect(rest.safe.bottom - feet(shot)).toBeLessThan(0.15);
    expect(feet(shot)).toBeLessThan(rest.safe.bottom);
    // A low camera: below the boss's head, looking nearly level.
    expect(shot.position.y).toBeLessThan(was.position.y / 2);
    // The boss's head stands over the team's.
    const bossTop = project(shot, rest.aspect, {
      x: bossHome.x,
      y: fight.bossHeight,
      z: bossHome.z,
    }).y;
    const teamTop = Math.min(
      ...posts.map((p) => project(shot, rest.aspect, { x: p.x, y: median.height, z: p.z }).y),
    );
    expect(bossTop).toBeLessThan(teamTop - 0.05);
  });

  for (const band of BANDS) {
    it(`keeps the boss's eyes and mouth in the band through a windup, its landing and a KO (${band.name})`, () => {
      for (const span of [highest, lowest]) {
        const face = bossFace(span, fight.bossHeight);
        const team = teamFaces(fight.friends);
        const director = new CameraDirector(homes, false, boss);
        const beats = BATTLE_CAMERA.boss.beats;
        const BEATS = [
          {
            at: 500,
            where: bossHome,
            cue: {
              ...cue,
              focus: 'b' as const,
              push: beats.windupPush,
              shake: 0,
              roll: 0,
              ramp: 700,
              tilt: beats.windupRoll,
            },
          },
          {
            at: 1200,
            where: posts[0]!,
            cue: {
              ...cue,
              focus: 'a' as const,
              push: beats.landingPush,
              shake: beats.landingShake,
              roll: 0,
            },
          },
          {
            at: 2000,
            where: bossHome,
            cue: {
              ...cue,
              focus: 'b' as const,
              push: BATTLE_CAMERA.koPush,
              pushDelay: 550,
              shake: 0,
              relax: beats.koRelax,
            },
          },
        ];
        let next = 0;
        for (let now = 0; now <= 4000; now += 1000 / 60) {
          const beat = BEATS[next];
          if (beat && now >= beat.at) {
            director.cue(beat.cue, now, beat.where);
            next++;
          }
          const shot = director.shot(now, band.aspect, band.safe, fight.fit, face, team);
          const top = project(shot, band.aspect, { x: face.x, y: face.high, z: face.z }).y;
          const bottom = project(shot, band.aspect, { x: face.x, y: face.low, z: face.z }).y;
          const at = `${band.name} ${now.toFixed(0)}`;
          expect(top, at).toBeGreaterThanOrEqual(band.safe.top - 1e-9);
          expect(bottom, at).toBeLessThanOrEqual(band.safe.bottom + 1e-9);
          expect(shot.distance, at).toBeLessThanOrEqual(boss.maxFitDistance);
        }
      }
    });
  }

  describe("the near friends' heads stay under the boss's mouth (#190 PR 6b, 5b)", () => {
    // The team's faces with their tops (head, ears, tuft: the whole drawn height) and body radius.
    const withTops = (friends: readonly { height: number; radius: number }[]): FacePoint[] =>
      teamFaces(friends).map((t, i) => ({
        ...t,
        r: friends[i]!.radius,
        top: friends[i]!.height,
      }));
    const mouthOf = (shot: CameraShot, a: number, face: FacePoint) =>
      project(shot, a, { x: face.x, y: face.low, z: face.z }).y;
    const topOf = (shot: CameraShot, a: number, t: FacePoint) =>
      project(shot, a, { x: t.x, y: t.top!, z: t.z }).y;
    const settle = (
      director: CameraDirector,
      band: (typeof BANDS)[number],
      f: FacePoint,
      team: FacePoint[],
    ) => {
      let shot = director.shot(0, band.aspect, band.safe, fight.fit, f, team);
      for (let now = 0; now <= 3000; now += 1000 / 60)
        shot = director.shot(now, band.aspect, band.safe, fight.fit, f, team);
      return shot;
    };

    for (const t of FIGHTS) {
      for (const band of BANDS) {
        it(`rises until the middle friend's top clears the mouth, eyes still in (${t.name}, ${band.name})`, () => {
          const face = { ...bossFace(lowest, t.bossHeight), w: 0.8 };
          const team = withTops(t.friends);
          const director = new CameraDirector(homes, false, boss);
          const shot = settle(director, band, face, team);
          const mid = team[1]!;
          const gap = topOf(shot, band.aspect, mid) - mouthOf(shot, band.aspect, face);
          if (director.rise < boss.riseMax - 1e-6) {
            expect(gap).toBeGreaterThanOrEqual(boss.mouthClear - 2e-3);
          }
          expect(director.rise).toBeGreaterThanOrEqual(0);
          expect(director.rise).toBeLessThanOrEqual(boss.riseMax);
          // No more than it needs: a friend already clear doesn't lift it further.
          if (director.rise > 1e-3) expect(gap).toBeLessThan(boss.mouthClear + 0.01);
          // The boss's eyes and mouth still sit in the band.
          const high = project(shot, band.aspect, { x: face.x, y: face.high, z: face.z }).y;
          expect(high).toBeGreaterThanOrEqual(band.safe.top - 1e-6);
          expect(mouthOf(shot, band.aspect, face)).toBeLessThanOrEqual(band.safe.bottom + 1e-6);
        });
      }
    }

    it('the eyes-only box alone missed it: a tall team covered the mouth on the phone (5b before)', () => {
      const t = FIGHTS[2]!; // the tall team
      const face = { ...bossFace(lowest, t.bossHeight), w: 0.8 };
      const team = withTops(t.friends);
      // The middle friend mid-hop (a cheer, a dodge): its head rises over the mouth.
      const hop = team.map((f, i) => (i === 1 ? { ...f, top: f.top! + 0.8 } : f));
      for (const row of [team, hop]) {
        const before = settle(
          new CameraDirector(homes, false, { ...boss, riseMax: 0 }),
          rest,
          face,
          row,
        );
        const gap = topOf(before, rest.aspect, row[1]!) - mouthOf(before, rest.aspect, face);
        expect(gap).toBeLessThan(boss.mouthClear);
        if (row === hop) expect(gap).toBeLessThan(0);
        const director = new CameraDirector(homes, false, boss);
        const after = settle(director, rest, face, row);
        expect(director.rise).toBeGreaterThan(0);
        const clear = topOf(after, rest.aspect, row[1]!) - mouthOf(after, rest.aspect, face);
        // Standing, it clears by the margin; mid-hop it rises all it may and gains on it.
        if (row === team) expect(clear).toBeGreaterThanOrEqual(boss.mouthClear - 2e-3);
        else {
          expect(director.rise).toBeCloseTo(boss.riseMax, 6);
          expect(clear).toBeGreaterThan(gap + 0.01);
        }
      }
    });

    it("counts a tuft, ears or horns over the head in a friend's top (topSpan)", () => {
      const tops = GAME_DATA.species.map((sp) => ({
        id: sp.id,
        top: topSpan(squishyParams(sp, `${sp.id}-1`, registry), registry),
      }));
      // Never under the head's top, never a giant's reach.
      for (const t of tops) {
        expect(t.top, t.id).toBeGreaterThanOrEqual(1);
        expect(t.top, t.id).toBeLessThan(2);
      }
      // Some kinds wear something over the head (the 5b frames: a tuft hid the mouth).
      expect(tops.filter((t) => t.top > 1.05).length).toBeGreaterThan(0);
      expect(tops.filter((t) => t.top === 1).length).toBeGreaterThan(0);
    });

    it('needs no rise without a friend in front of the mouth, outside a boss fight, or with no tops', () => {
      const t = FIGHTS[2]!;
      const face = { ...bossFace(lowest, t.bossHeight), w: 0.8 };
      const shot = { ...new CameraDirector(homes, true, boss).shot(0, aspect, rest.safe, t.fit) };
      const team = withTops(t.friends);
      // Far off to the side: not in front of the face.
      const aside = team.map((f) => ({ ...f, x: f.x + 40 }));
      expect(clearRise(shot, face, aside, 0, boss)).toBe(0);
      expect(clearRise(shot, face, team, 0, BATTLE_CAMERA)).toBe(0);
      expect(clearRise(shot, face, teamFaces(t.friends), 0, boss)).toBe(0);
      expect(clearRise(shot, face, team, 0, boss)).toBeGreaterThan(0);
      expect(clearRise(shot, face, team, 0, boss)).toBeLessThanOrEqual(boss.riseMax);
    });

    it('holds while the boss is turned away and settles back down when the boss leaves', () => {
      const t = FIGHTS[2]!;
      const face = { ...bossFace(lowest, t.bossHeight), w: 0.8 };
      const team = withTops(t.friends);
      const director = new CameraDirector(homes, false, boss);
      settle(director, rest, face, team);
      const risen = director.rise;
      expect(risen).toBeGreaterThan(0);
      let now = 3000;
      for (; now <= 4000; now += 1000 / 60)
        director.shot(now, rest.aspect, rest.safe, t.fit, { ...face, facing: -1 }, team);
      expect(director.rise).toBeCloseTo(risen, 6);
      for (; now <= 7000; now += 1000 / 60)
        director.shot(now, rest.aspect, rest.safe, t.fit, null, []);
      expect(director.rise).toBe(0);
      expect(director.moving(now)).toBe(false);
    });
  });
});

describe('the boss beats in the camera (#190 PR 2)', () => {
  const beats = BATTLE_CAMERA.boss.beats;
  const windup = {
    ...cue,
    push: beats.windupPush,
    shake: 0,
    roll: 0,
    ramp: 700,
    tilt: beats.windupRoll,
  };
  const rollOf = (shot: CameraShot) => Math.atan2(shot.up.x, shot.up.y);

  it('pushes in slowly across the windup, leaning a touch, then lets go after the beat', () => {
    const director = new CameraDirector(homes, false);
    const base = director.shot(0, 0.46, safe, fit).distance;
    director.cue(windup, 0);
    let last = base;
    for (let now = 0; now <= 700; now += 1000 / 60) {
      const d = director.shot(now, 0.46, safe, fit).distance;
      // A slow, steady push: closer every frame, no jump.
      expect(d).toBeLessThanOrEqual(last + 1e-9);
      expect(last - d).toBeLessThan(base * 0.01);
      last = d;
    }
    expect(director.moving(600)).toBe(true);
    const held = director.shot(700, 0.46, safe, fit);
    expect(held.distance / base).toBeCloseTo(1 - beats.windupPush, 2);
    expect(rollOf(held)).toBeGreaterThan(beats.windupRoll * 0.9);
    // The next beat lets the lean go, eased; the push relaxes on its own.
    director.rest();
    let shot = held;
    for (let now = 716; now <= 3500; now += 1000 / 60) shot = director.shot(now, 0.46, safe, fit);
    expect(Math.abs(rollOf(shot))).toBeLessThan(1e-4);
    expect(shot.distance / base).toBeGreaterThan(0.995);
    expect(director.moving(3500)).toBe(false);
  });

  it('starts the slow push from wherever the last beat left it: no jump', () => {
    const director = new CameraDirector(homes, false);
    const base = director.shot(0, 0.46, safe, fit).distance;
    director.cue({ ...cue, push: BATTLE_CAMERA.followPush, shake: 0 }, 0);
    let before = base;
    for (let now = 0; now <= 300; now += 1000 / 60)
      before = director.shot(now, 0.46, safe, fit).distance;
    expect(before).toBeLessThan(base * 0.99);
    director.cue(windup, 316);
    const first = director.shot(316 + 1000 / 60, 0.46, safe, fit).distance;
    expect(Math.abs(first - before)).toBeLessThan(base * 0.01);
  });

  it("a boss push-in never closes past the row's width, so no end friend is cropped (#190 PR 6b)", () => {
    // A wide row on a phone: the width binds, so any deep push would clip the ends.
    const row = [
      { x: -4.3, z: -3.8, r: 4, h: 4 },
      { x: 5.1, z: -1.4, r: 4, h: 4 },
    ];
    const director = new CameraDirector(homes, false, cameraFor(true));
    const base = { distance: director.shot(0, 0.46, safe, row).distance };
    const { side } = frameDistance(0.46, safe, row, cameraFor(true));
    director.cue({ ...cue, push: 0.5, shake: 0 }, 0);
    let d = base.distance;
    for (let now = 0; now <= 1500; now += 1000 / 60)
      d = director.shot(now, 0.46, safe, row).distance;
    expect(d).toBeGreaterThanOrEqual(
      Math.min(base.distance, side * cameraFor(true).sideKeep) - 1e-6,
    );
    expect(d).toBeLessThan(base.distance);
  });

  it('pulls back slowly after the boss is tuckered out', () => {
    const after = (relax?: number) => {
      const director = new CameraDirector(homes, false);
      const base = director.shot(0, 0.46, safe, fit).distance;
      director.cue(
        { ...cue, push: BATTLE_CAMERA.koPush, shake: 0, ...(relax ? { relax } : {}) },
        0,
      );
      let d = base;
      for (let now = 0; now <= 1200; now += 1000 / 60)
        d = director.shot(now, 0.46, safe, fit).distance;
      return d / base;
    };
    // Still pushed in where a plain KO has nearly relaxed.
    expect(after(beats.koRelax)).toBeLessThan(after() - 0.02);
  });

  it('keeps pulling back slowly through the end step and the rest after it', () => {
    // The boss's tuckered step (1100 ms, the push from 550), then `end`, then the settle's rest().
    const pushAt = (relax?: number) => {
      const director = new CameraDirector(homes, false, cameraFor(true));
      const base = director.shot(0, 0.46, safe, fit).distance;
      const ko = { ...cue, push: BATTLE_CAMERA.koPush, pushDelay: 550, shake: 0 };
      director.cue(relax ? { ...ko, relax } : ko, 0);
      let d = base;
      for (let now = 0; now <= 2200; now += 1000 / 60) {
        if (Math.abs(now - 1100) < 8)
          director.cue({ ...cue, focus: 'b', push: 0, shake: 0, roll: 0 }, now);
        if (Math.abs(now - 1700) < 8) director.rest();
        d = director.shot(now, 0.46, safe, fit).distance;
        if (Math.abs(now - 1600) < 8) expect(1 - d / base).toBeGreaterThan(relax ? 0.03 : -1);
      }
      return 1 - d / base;
    };
    // Still clearly pushed in a second after the end step where a plain KO is long done.
    expect(pushAt(beats.koRelax)).toBeGreaterThan(0.02);
    expect(pushAt()).toBeLessThan(0.002);
  });

  it('a new push-in, or a lean or rest mid-windup, takes over without a jump', () => {
    const director = new CameraDirector(homes, false);
    const base = director.shot(0, 0.46, safe, fit).distance;
    director.cue({ ...cue, push: BATTLE_CAMERA.koPush, shake: 0, relax: beats.koRelax }, 0);
    for (let now = 0; now <= 500; now += 1000 / 60) director.shot(now, 0.46, safe, fit);
    // A real beat after the pull-back replaces it (the plain decay is back).
    director.cue({ ...cue, push: 0.1, shake: 0 }, 516);
    for (let now = 516; now <= 3000; now += 1000 / 60) director.shot(now, 0.46, safe, fit);
    expect(director.shot(3016, 0.46, safe, fit).distance / base).toBeGreaterThan(0.995);
    // Mid-windup, rest() eases back from where the push is.
    director.cue(windup, 3100);
    let before = director.shot(3400, 0.46, safe, fit).distance;
    director.rest();
    for (let now = 3416; now <= 3600; now += 1000 / 60) {
      const d = director.shot(now, 0.46, safe, fit).distance;
      expect(Math.abs(d - before)).toBeLessThan(base * 0.01);
      before = d;
    }
  });

  it('with reduced motion: no push, ramp, lean or shake, a snap follow', () => {
    const director = new CameraDirector(homes, true, cameraFor(true));
    const base = director.shot(0, 0.46, safe, fit).distance;
    director.cue({ ...windup, shake: 0.2 }, 0);
    const shot = director.shot(16, 0.46, safe, fit);
    expect(shot.distance).toBeCloseTo(base, 9);
    expect(rollOf(shot)).toBe(0);
    expect(director.moving(16)).toBe(false);
  });
});

describe("the boss entrance's stomp keeps the picker's lean (#190 PR 3)", () => {
  const beats = BATTLE_CAMERA.boss.beats;
  const lean = { x: HOMES.mine.x + 2, z: HOMES.mine.z };
  const frames = (director: CameraDirector, from: number, to: number) => {
    let shot = director.shot(from, 0.46, safe, fit);
    for (let now = from; now <= to; now += 1000 / 60) shot = director.shot(now, 0.46, safe, fit);
    return shot;
  };
  /** A director leaned to the picked squishy and settled there. */
  const leaned = (reduced: boolean) => {
    const director = new CameraDirector(homes, reduced);
    director.lean(lean);
    frames(director, 0, 2000);
    return director;
  };

  it('pushes in and shakes, then relaxes back with the lean still on', () => {
    const still = leaned(false);
    const stomped = leaned(false);
    const before = frames(stomped, 2000, 2000);
    stomped.thump(beats.landingPush, beats.landingShake, 2016);
    // The closest the push gets: in from the leaned shot.
    let closest = before.distance;
    for (let now = 2016; now <= 2600; now += 1000 / 60) {
      closest = Math.min(closest, stomped.shot(now, 0.46, safe, fit).distance);
    }
    expect(closest).toBeLessThan(before.distance * 0.995);
    expect(stomped.moving(2100)).toBe(true);
    const after = frames(stomped, 2600, 6000);
    const held = frames(still, 2000, 6000);
    // Back to the same leaned shot: the lean survived the stomp.
    expect(after.target.x).toBeCloseTo(held.target.x, 3);
    expect(after.target.z).toBeCloseTo(held.target.z, 3);
    expect(after.distance).toBeCloseTo(held.distance, 2);
    // A cue (the round-1 bug) would have pulled the framing back to the middle.
    const cued = leaned(false);
    cued.cue({ ...cue, focus: null, push: beats.landingPush, shake: beats.landingShake }, 2016);
    expect(Math.abs(frames(cued, 2016, 6000).target.x - held.target.x)).toBeGreaterThan(1e-3);
  });

  it('does nothing under reduced motion: no push, no shake', () => {
    const still = leaned(true);
    const stomped = leaned(true);
    stomped.thump(beats.landingPush, beats.landingShake, 2016);
    for (const t of [2032, 2100, 2400]) {
      const a = frames(stomped, t, t);
      const b = frames(still, t, t);
      expect(a.position).toEqual(b.position);
      expect(a.target).toEqual(b.target);
    }
    expect(stomped.moving(2100)).toBe(false);
  });
});
