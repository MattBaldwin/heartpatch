import { CinematicSchema, OPENING_CINEMATIC, type CinematicInput } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { MAX_FRAME_S, Playback } from './playback.js';
import { PRESS } from './skip.js';
import { createTimeline } from './timeline.js';

const SHORT: CinematicInput = {
  id: 'short',
  world: { hexSize: 1, regions: [{ ground: 'meadow', center: { q: 0, r: 0 }, radius: 0 }] },
  shots: [
    {
      id: 'only',
      title: 'Only',
      duration: 10,
      transition: 'cut',
      music: 'wonder',
      camera: [{ at: 0, position: [0, 1, -1], target: [0, 0, 0] }],
      mood: [{ at: 0, drain: 0, night: 0, glow: 0 }],
      captions: [
        { at: 1, until: 4, text: 'One two.' },
        { at: 5, until: 8, text: 'Three four.' },
      ],
      cues: [
        { at: 0.05, cue: 'bloom' },
        { at: 6, cue: 'giggle' },
      ],
    },
  ],
};
const timeline = createTimeline(CinematicSchema.parse(SHORT));

/** Runs `seconds` of frames at 60 fps; returns every cue fired. */
function run(p: Playback, seconds: number): string[] {
  const cues: string[] = [];
  for (let i = 0; i < Math.round(seconds * 60); i += 1)
    cues.push(...p.step(1 / 60).map((c) => c.cue));
  return cues;
}

describe('Playback', () => {
  it('runs with the frames, fires each cue once, and ends watched', () => {
    const p = new Playback(timeline, { skippable: false });
    expect(run(p, 5)).toEqual(['bloom']);
    expect(p.t).toBeCloseTo(5, 5);
    expect(run(p, 6)).toEqual(['giggle']);
    expect(p.ended).toBe('watched');
    expect(p.t).toBe(10);
    // Nothing more after the end.
    expect(p.step(1)).toEqual([]);
  });

  it('never jumps ahead after a long frame (a hidden tab, a hitch)', () => {
    const p = new Playback(timeline, { skippable: false });
    p.step(30);
    expect(p.t).toBe(MAX_FRAME_S);
    p.step(-1);
    expect(p.t).toBe(MAX_FRAME_S);
  });

  it('jumps a tap to the next caption, silently, and ends after the last', () => {
    const p = new Playback(timeline, { skippable: false });
    p.pressStart(0);
    p.pressEnd(100);
    expect(p.t).toBe(1);
    p.tap();
    expect(p.t).toBe(5);
    // The giggle at 6 still plays as time runs on; the bloom jumped over doesn't.
    expect(run(p, 1.5)).toEqual(['giggle']);
    p.tap();
    expect(p.ended).toBe('watched');
  });

  it('skips on a long press, even the first time', () => {
    const p = new Playback(timeline, { skippable: false });
    p.pressStart(1000);
    expect(p.holdTick(1000 + PRESS.ringAfterMs / 2)).toBe(0);
    expect(p.holdTick(1000 + (PRESS.ringAfterMs + PRESS.holdMs) / 2)).toBeCloseTo(0.5);
    expect(p.ended).toBeNull();
    expect(p.holdTick(1000 + PRESS.holdMs)).toBe(1);
    expect(p.ended).toBe('skipped');
    // Letting go afterwards is not also a tap.
    p.pressEnd(1000 + PRESS.holdMs + 50);
    expect(p.t).toBe(0);
  });

  it('ignores a press let go between a tap and a hold, or taken away', () => {
    const p = new Playback(timeline, { skippable: false });
    p.pressStart(0);
    p.pressEnd(PRESS.tapMaxMs + 100);
    expect(p.t).toBe(0);
    p.pressStart(0);
    p.pressCancel();
    expect(p.holdTick(PRESS.holdMs * 2)).toBe(0);
    expect(p.ended).toBeNull();
  });

  it('offers the Skip button only once it has been seen', () => {
    const first = new Playback(timeline, { skippable: false });
    expect(first.skip()).toBe(false);
    expect(first.ended).toBeNull();
    const again = new Playback(timeline, { skippable: true });
    expect(again.skip()).toBe(true);
    expect(again.ended).toBe('skipped');
  });

  it('reaches the end of the real cinematic in a handful of taps', () => {
    const p = new Playback(createTimeline(OPENING_CINEMATIC), { skippable: false });
    let taps = 0;
    while (!p.ended && taps < 50) {
      p.tap();
      taps += 1;
    }
    expect(p.ended).toBe('watched');
    expect(taps).toBeLessThan(25);
  });
});
