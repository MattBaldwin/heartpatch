import {
  CINEMATIC_MAX_SECONDS,
  CinematicSchema,
  OPENING_CINEMATIC,
  type Cinematic,
  type CinematicInput,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { CUE_NAMES } from '../audio/cues.js';
import {
  actorAt,
  cameraAt,
  captionAt,
  CLAIM_POP,
  claimScale,
  createTimeline,
  cuesBetween,
  moodAt,
  movesBetween,
  musicAt,
  nextStop,
  segments,
  shakeAt,
  shotAt,
  smoothPath,
  titleAt,
  TIMELINE,
  veilAt,
} from './timeline.js';

/** Two short shots: enough to check every rule by hand. */
const TINY: CinematicInput = {
  id: 'tiny',
  world: { hexSize: 1, regions: [{ ground: 'meadow', center: { q: 0, r: 0 }, radius: 1 }] },
  shots: [
    {
      id: 'one',
      title: 'One',
      duration: 10,
      transition: 'cut',
      music: 'wonder',
      camera: [
        { at: 0, position: [0, 10, -10], target: [0, 0, 0], fov: 0.6 },
        { at: 10, position: [10, 0, 0], target: [0, 0, 10], fov: 1.0 },
      ],
      mood: [
        { at: 0, drain: 0, night: 0, glow: 1 },
        { at: 10, drain: 1, night: 0.5, glow: 0 },
      ],
      captions: [
        { at: 1, until: 4, text: 'Hello there.' },
        { at: 6, until: 9, text: 'Bye now.' },
      ],
      cues: [{ at: 2, cue: 'bloom' }],
      actors: [
        {
          id: 'hopper',
          kind: 'squishy',
          species: 'puddlepuff',
          path: [
            { at: 2, x: 0, z: 0, scale: 0 },
            { at: 4, x: 0, z: 0, y: 2, scale: 1 },
            { at: 6, x: 4, z: 0, scale: 1 },
          ],
          moves: [{ at: 4, move: 'bounce' }],
        },
        {
          id: 'flicker',
          kind: 'hollow-man',
          path: [
            { at: 0, x: 0, z: 5, alpha: 1 },
            { at: 5, x: 0, z: 5, alpha: 0.2, flash: true },
            { at: 6, x: 0, z: 5, alpha: 1 },
            { at: 8, x: 0, z: 5, alpha: 1, lit: false },
          ],
        },
        { id: 'stayer', kind: 'hearthfire', path: [{ at: 3, x: 1, z: 1 }] },
      ],
    },
    {
      id: 'two',
      title: 'Two',
      duration: 8,
      transition: 'dissolve',
      music: 'none',
      camera: [
        { at: 0, position: [0, 1, 0], target: [0, 0, 1] },
        { at: 3, position: [0, 3, 0], target: [0, 0, 1] },
        { at: 3, cut: true, position: [5, 5, 5], target: [0, 0, 0] },
        { at: 8, position: [5, 1, 5], target: [0, 0, 0] },
      ],
      mood: [{ at: 0, drain: 0.5, night: 0.5, glow: 0 }],
      captions: [{ at: 1, until: 5, text: 'The end.' }],
      dissolves: [3],
      titleAt: 6,
      cues: [{ at: 6, cue: 'title' }],
    },
  ],
};

const tiny: Cinematic = CinematicSchema.parse(TINY);
const timeline = createTimeline(tiny);
const shot = (i: number) => tiny.shots[i]!;

describe('timeline: shots', () => {
  it('lays shots end to end', () => {
    expect(timeline.starts).toEqual([0, 10]);
    expect(timeline.total).toBe(18);
  });

  it('finds the shot at a time, the next one starting exactly on its boundary', () => {
    expect(shotAt(timeline, 0)).toMatchObject({ index: 0, local: 0 });
    expect(shotAt(timeline, 9.99)).toMatchObject({ index: 0 });
    expect(shotAt(timeline, 10)).toMatchObject({ index: 1, local: 0 });
    expect(shotAt(timeline, 12.5)).toMatchObject({ index: 1, local: 2.5 });
    // Clamped at both ends.
    expect(shotAt(timeline, -3)).toMatchObject({ index: 0, local: 0 });
    expect(shotAt(timeline, 99)).toMatchObject({ index: 1, local: 8 });
  });

  it('knows the music under each shot', () => {
    expect(musicAt(timeline, 5)).toBe('wonder');
    expect(musicAt(timeline, 11)).toBe('none');
  });
});

describe('timeline: interpolation', () => {
  it('passes through every key, easing in and out at the ends', () => {
    const keys = [
      { t: 0, v: 0 },
      { t: 1, v: 10 },
      { t: 3, v: 30 },
    ];
    expect(smoothPath(keys, -1)).toBe(0);
    expect(smoothPath(keys, 0)).toBe(0);
    expect(smoothPath(keys, 1)).toBeCloseTo(10);
    expect(smoothPath(keys, 3)).toBe(30);
    expect(smoothPath(keys, 4)).toBe(30);
    // Ease in: slow at the start.
    expect(smoothPath(keys, 0.1)).toBeLessThan(1);
    // Monotone: never runs backwards between rising keys.
    let last = -Infinity;
    for (let t = 0; t <= 3; t += 0.05) {
      const v = smoothPath(keys, t);
      expect(v).toBeGreaterThanOrEqual(last - 1e-9);
      last = v;
    }
  });

  it('never overshoots a hold or a peak', () => {
    const hold = [
      { t: 0, v: 5 },
      { t: 4, v: 5 },
      { t: 5, v: 9 },
    ];
    for (let t = 0; t <= 4; t += 0.25) expect(smoothPath(hold, t)).toBeCloseTo(5);
    const arc = [
      { t: 0, v: 0 },
      { t: 1, v: 2 },
      { t: 2, v: 0 },
    ];
    for (let t = 0; t <= 2; t += 0.05) expect(smoothPath(arc, t)).toBeLessThanOrEqual(2 + 1e-9);
  });

  it('splits keys into runs at cuts and at repeated times', () => {
    const runs = segments([{ at: 0 }, { at: 3 }, { at: 3, cut: true }, { at: 5 }, { at: 5 }]);
    expect(runs.map((r) => r.map((k) => k.at))).toEqual([[0, 3], [3, 5], [5]]);
  });
});

describe('timeline: camera', () => {
  it('moves between keyframes and lands on them', () => {
    const start = cameraAt(shot(0), 0, false);
    expect(start).toEqual({ position: [0, 10, -10], target: [0, 0, 0], fov: 0.6 });
    const middle = cameraAt(shot(0), 5, false);
    expect(middle.position[0]).toBeCloseTo(5);
    expect(middle.fov).toBeCloseTo(0.8);
    expect(cameraAt(shot(0), 10, false).position).toEqual([10, 0, 0]);
  });

  it('cuts instead of easing across a cut key', () => {
    expect(cameraAt(shot(1), 2.99, false).position[1]).toBeCloseTo(3, 1);
    expect(cameraAt(shot(1), 3, false).position).toEqual([5, 5, 5]);
    // A shot without a fov uses the default one.
    expect(cameraAt(shot(1), 1, false).fov).toBeCloseTo(0.8);
  });

  it('holds still for reduced motion: each run keeps its settled framing', () => {
    for (const t of [0, 2, 5, 10]) {
      expect(cameraAt(shot(0), t, true).position).toEqual([10, 0, 0]);
    }
    expect(cameraAt(shot(1), 1, true).position).toEqual([0, 3, 0]);
    expect(cameraAt(shot(1), 7, true).position).toEqual([5, 1, 5]);
  });
});

describe('timeline: actors and mood', () => {
  const [hopper, flicker, stayer] = shot(0).actors;

  it('is on screen from its first key to its last', () => {
    expect(actorAt(hopper!, 1.9, false, 10)).toBeNull();
    expect(actorAt(hopper!, 2, false, 10)).toMatchObject({ scale: 0 });
    expect(actorAt(hopper!, 4, false, 10)).toMatchObject({ y: 2, scale: 1 });
    expect(actorAt(hopper!, 6, false, 10)).toMatchObject({ x: 4, y: 0 });
    expect(actorAt(hopper!, 6.01, false, 10)).toBeNull();
    // A one-key actor stays to the end of its shot.
    expect(actorAt(stayer!, 2, false, 10)).toBeNull();
    expect(actorAt(stayer!, 10, false, 10)).toMatchObject({ x: 1, z: 1, lit: true });
  });

  it('flickers, except for reduced motion (no flashes)', () => {
    expect(actorAt(flicker!, 5, false, 10)!.alpha).toBeCloseTo(0.2);
    expect(actorAt(flicker!, 5, true, 10)!.alpha).toBeCloseTo(1);
  });

  it('steps `lit` and defaults the rest', () => {
    expect(actorAt(flicker!, 7.9, false, 10)).toMatchObject({ lit: true, glow: 1, scale: 1 });
    expect(actorAt(flicker!, 8, false, 10)).toMatchObject({ lit: false });
  });

  it('eases the mood between keys', () => {
    expect(moodAt(shot(0), 0)).toEqual({ drain: 0, night: 0, glow: 1 });
    expect(moodAt(shot(0), 5).drain).toBeCloseTo(0.5);
    expect(moodAt(shot(0), 10)).toEqual({ drain: 1, night: 0.5, glow: 0 });
    expect(moodAt(shot(1), 4)).toEqual({ drain: 0.5, night: 0.5, glow: 0 });
  });
});

describe('timeline: captions, taps and moments', () => {
  it('shows each caption for its time, across shots', () => {
    expect(captionAt(timeline, 0.5)).toBeNull();
    expect(captionAt(timeline, 1)?.text).toBe('Hello there.');
    expect(captionAt(timeline, 3.99)?.text).toBe('Hello there.');
    expect(captionAt(timeline, 4)).toBeNull();
    expect(captionAt(timeline, 7)?.text).toBe('Bye now.');
    expect(captionAt(timeline, 11)).toMatchObject({ text: 'The end.', shot: 1, index: 2 });
  });

  it('jumps a tap to the next caption, then the title card, then the end', () => {
    expect(nextStop(timeline, 0)).toBe(1);
    expect(nextStop(timeline, 1)).toBe(6);
    expect(nextStop(timeline, 6)).toBe(11);
    expect(nextStop(timeline, 11)).toBe(16);
    expect(nextStop(timeline, 16)).toBe(18);
    expect(nextStop(timeline, 18)).toBe(18);
  });

  it('fires cues and moves once each as time passes, and none across a seek', () => {
    expect(cuesBetween(timeline, 0, 2)).toEqual([{ at: 2, cue: 'bloom' }]);
    expect(cuesBetween(timeline, 2, 3)).toEqual([]);
    expect(cuesBetween(timeline, 15, 16)).toEqual([{ at: 16, cue: 'title' }]);
    expect(cuesBetween(timeline, 6, 6)).toEqual([]);
    expect(movesBetween(timeline, 3.9, 4.1)).toEqual([
      { at: 4, shot: 0, actor: 'hopper', move: 'bounce' },
    ]);
  });

  it('veils the dissolves, the start and the end, and fades the title in', () => {
    expect(veilAt(timeline, 0)).toBe(1);
    expect(veilAt(timeline, 5)).toBe(0);
    expect(veilAt(timeline, 10)).toBe(1);
    expect(veilAt(timeline, 10 + TIMELINE.dissolveHalfS)).toBeCloseTo(0);
    expect(veilAt(timeline, 13)).toBe(1);
    expect(veilAt(timeline, 18)).toBe(1);
    expect(titleAt(timeline, 15.9)).toBe(0);
    expect(titleAt(timeline, 16 + TIMELINE.titleFadeS / 2)).toBeCloseTo(0.5);
    expect(titleAt(timeline, 18)).toBe(1);
  });
});

describe('the opening cinematic', () => {
  const opening = createTimeline(OPENING_CINEMATIC);

  it('runs under two and a half minutes, and every tap gets closer to the end', () => {
    expect(opening.total).toBeGreaterThanOrEqual(90);
    expect(opening.total).toBeLessThanOrEqual(CINEMATIC_MAX_SECONDS);
    let t = 0;
    let taps = 0;
    while (t < opening.total) {
      const next = nextStop(opening, t);
      expect(next).toBeGreaterThan(t);
      t = next;
      taps += 1;
    }
    expect(taps).toBe(opening.captions.length + 2);
  });

  it('only asks for sounds the audio engine has', () => {
    const cues = new Set(cuesBetween(opening, -1, opening.total).map((c) => c.cue));
    for (const cue of cues) expect(CUE_NAMES).toContain(cue);
  });

  it('has a camera and mood for every moment, with or without reduced motion', () => {
    for (let t = 0; t <= opening.total; t += 0.5) {
      const { shot: s, local } = shotAt(opening, t);
      for (const reduced of [false, true]) {
        const pose = cameraAt(s, local, reduced);
        for (const n of [...pose.position, ...pose.target, pose.fov]) expect(n).not.toBeNaN();
      }
      const mood = moodAt(s, local);
      expect(Object.values(mood).every((n) => n >= 0 && n <= 1)).toBe(true);
    }
  });

  it('has the title card at the end', () => {
    expect(opening.titleAt).not.toBeNull();
    expect(opening.total - opening.titleAt!).toBeGreaterThan(3);
  });
});

describe('"Your part" and the Scatter (owner decisions 2026-10-04)', () => {
  const opening = createTimeline(OPENING_CINEMATIC);
  const shot = (id: string) => OPENING_CINEMATIC.shots.find((s) => s.id === id)!;

  it('pops claimed land up with a little bounce, or just shows it for reduced motion', () => {
    expect(claimScale(5, 4.9, false)).toBe(0);
    expect(claimScale(5, 4.9, true)).toBe(0);
    expect(claimScale(5, 5, false)).toBeCloseTo(CLAIM_POP.from);
    expect(claimScale(5, 5 + CLAIM_POP.seconds / 2, false)).toBeCloseTo(CLAIM_POP.overshoot);
    expect(claimScale(5, 5 + CLAIM_POP.seconds, false)).toBe(1);
    // Reduced motion: no growing, no overshoot, the colour is just there.
    for (const s of [0, 0.1, 0.2, 0.3]) expect(claimScale(5, 5 + s, true)).toBe(1);
  });

  it('shakes the camera briefly as the Heartpatch breaks, and never for reduced motion', () => {
    const scatter = shot('great-scatter');
    const [shake] = scatter.shakes;
    expect(shake).toBeDefined();
    const size = (local: number, reduced: boolean) =>
      Math.hypot(...shakeAt(scatter, local, reduced));
    expect(size(shake!.at - 0.1, false)).toBe(0);
    expect(size(shake!.at + 0.05, false)).toBeGreaterThan(0);
    expect(size(shake!.at + 0.05, false)).toBeLessThanOrEqual(shake!.strength * 1.5);
    expect(size(shake!.at + shake!.seconds, false)).toBe(0);
    for (let t = 0; t <= scatter.duration; t += 0.05) expect(size(t, true)).toBe(0);
    // Nothing else in the story shakes.
    const shaking = OPENING_CINEMATIC.shots.filter((s) => s.shakes.length > 0).map((s) => s.id);
    expect(shaking).toEqual(['great-scatter']);
  });

  it('raises his arms to reach as the Heartpatch breaks, with or without reduced motion', () => {
    const scatter = shot('great-scatter');
    const hollow = scatter.actors.find((a) => a.kind === 'hollow-man')!;
    const breaks = scatter.cues.find((c) => c.cue === 'shatter')!.at;
    for (const reduced of [false, true]) {
      expect(actorAt(hollow, 0.5, reduced, scatter.duration)?.reach).toBeLessThan(0.5);
      expect(actorAt(hollow, breaks, reduced, scatter.duration)?.reach).toBeCloseTo(1);
    }
    // Squishies, Keepers and the rest never reach.
    for (const s of OPENING_CINEMATIC.shots) {
      for (const a of s.actors.filter((x) => x.kind !== 'hollow-man')) {
        expect(actorAt(a, a.path[0]!.at, false, s.duration)?.reach ?? 0).toBe(0);
      }
    }
  });

  it('flickers him only with flash keys, which reduced motion drops', () => {
    for (const id of ['hollow-man', 'great-scatter']) {
      const s = shot(id);
      const hollow = s.actors.find((a) => a.kind === 'hollow-man')!;
      // Under reduced motion his fade never dips and comes back (no flicker).
      let dipped = false;
      let last = -1;
      for (let t = 0; t <= s.duration; t += 0.05) {
        const alpha = actorAt(hollow, t, true, s.duration)?.alpha ?? 0;
        if (alpha < last - 1e-6) dipped = true;
        if (dipped) expect(alpha).toBeLessThanOrEqual(last + 1e-6);
        last = alpha;
      }
    }
  });

  it('plays its cues in the story: the sting, the cold wind, a toss and a new friend', () => {
    const cues = cuesBetween(opening, -1, opening.total).map((c) => c.cue);
    for (const cue of ['hollow-sting', 'cold-wind', 'charm', 'yay']) expect(cues).toContain(cue);
  });
});
