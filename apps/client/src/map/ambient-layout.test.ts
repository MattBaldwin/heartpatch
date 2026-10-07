import { describe, expect, it } from 'vitest';
import { AmbientJudge, ambientMode, moteShare, motesFor } from './ambient-layout.js';
import { AMBIENT, HEX_SIZE, MOTE_KINDS, MOTES, THANKSGIVING } from './map-config.js';
import { testView } from './test-view.js';

const { tiles } = testView();
const KINDS = MOTE_KINDS;

describe('motesFor', () => {
  it('is the same on every call', () => {
    for (const kind of KINDS)
      expect(motesFor(kind, tiles, HEX_SIZE)).toEqual(motesFor(kind, tiles, HEX_SIZE));
  });

  it('never goes over its cap, and every kind shows on a real map', () => {
    for (const kind of KINDS) {
      const motes = motesFor(kind, tiles, HEX_SIZE);
      expect(motes.length, kind).toBeLessThanOrEqual(MOTES[kind].max);
      expect(motes.length, kind).toBeGreaterThan(0);
    }
  });

  it("takes a season's own amount and land (Thanksgiving's leaves)", () => {
    const autumn = motesFor('leaves', tiles, HEX_SIZE, THANKSGIVING.leaves);
    expect(autumn.length).toBeGreaterThan(motesFor('leaves', tiles, HEX_SIZE).length);
    expect(autumn.length).toBeLessThanOrEqual(THANKSGIVING.leaves.max);
    const meadows = tiles.filter((t) => t.terrain === 'meadow' && t.homeSlot === null);
    expect(motesFor('leaves', meadows, HEX_SIZE)).toEqual([]);
    expect(motesFor('leaves', meadows, HEX_SIZE, THANKSGIVING.leaves).length).toBeGreaterThan(0);
  });

  it('keeps motes over their own terrain, never over home tiles', () => {
    const homes = testView().tiles.filter((t) => t.homeSlot !== null);
    const leaves = motesFor('leaves', homes, HEX_SIZE);
    expect(leaves).toEqual([]);
    const lakeOnly = tiles.filter((t) => t.terrain === 'lake');
    expect(motesFor('leaves', lakeOnly, HEX_SIZE)).toEqual([]);
    expect(motesFor('fireflies', lakeOnly, HEX_SIZE).length).toBeGreaterThan(0);
  });

  it('spreads any first share over the whole map, not just its first rows', () => {
    const pollen = motesFor('pollen', tiles, HEX_SIZE);
    const half = pollen.slice(0, Math.round(pollen.length / 2));
    const xs = half.map((m) => m.x);
    const all = pollen.map((m) => m.x);
    const span = (v: number[]) => Math.max(...v) - Math.min(...v);
    expect(span(xs)).toBeGreaterThan(span(all) * 0.7);
  });
});

describe('ambientMode', () => {
  it('runs live by default, stands still for reduced motion, and is off when low or slow', () => {
    expect(ambientMode({ tier: 'high', reducedMotion: false, slow: false })).toBe('live');
    expect(ambientMode({ tier: 'medium', reducedMotion: false, slow: false })).toBe('live');
    expect(ambientMode({ tier: 'high', reducedMotion: true, slow: false })).toBe('still');
    expect(ambientMode({ tier: 'low', reducedMotion: false, slow: false })).toBe('off');
    expect(ambientMode({ tier: 'high', reducedMotion: false, slow: true })).toBe('off');
  });

  it('drops motes first as the tier steps down', () => {
    expect(moteShare('high')).toBe(1);
    expect(moteShare('medium')).toBeLessThan(1);
    expect(moteShare('low')).toBe(0);
  });
});

describe('AmbientJudge', () => {
  /** Feeds `frames` ambient frames `gap` ms apart, after the grace period. */
  function feed(judge: AmbientJudge, gap: number, frames: number, from = 0): number {
    let t = from;
    for (let i = 0; i < frames; i++) {
      judge.record(t);
      t += gap;
    }
    return t;
  }

  it('keeps ambient life on a device that keeps up (60 fps, or 30 fps in Low Power Mode)', () => {
    for (const gap of [33, 34]) {
      const judge = new AmbientJudge();
      feed(judge, gap, 400);
      expect(judge.slow).toBe(false);
    }
  });

  it('switches it off for good on a device that can’t', () => {
    const judge = new AmbientJudge();
    const after = feed(judge, 120, Math.ceil(AMBIENT.graceMs / 120) + AMBIENT.judgeFrames + 2);
    expect(judge.slow).toBe(true);
    feed(judge, 33, 200, after);
    expect(judge.slow).toBe(true);
  });

  it('ignores the first moments (shader compiles) and a hidden tab', () => {
    const judge = new AmbientJudge();
    // Slow while loading…
    let t = feed(judge, 200, Math.floor(AMBIENT.graceMs / 200));
    // …then smooth, with the tab hidden for a while now and then.
    for (let i = 0; i < 10; i++) {
      t = feed(judge, 33, 30, t);
      t += 5000;
      judge.skip(); // back from a hidden page
    }
    expect(judge.slow).toBe(false);
  });

  it('catches a renderer that takes a second a frame within a few frames (software GL)', () => {
    const judge = new AmbientJudge();
    const t = feed(judge, 33, Math.ceil(AMBIENT.graceMs / 33) + 1);
    expect(judge.slow).toBe(false);
    // (The first of these still lands 33 ms after the last smooth frame.)
    feed(judge, 1200, Math.floor(AMBIENT.judgeFrames / 2) + 2, t);
    expect(judge.slow).toBe(true);
  });

  it('shrugs off a single hitch (a shader compiling) on a smooth device', () => {
    const judge = new AmbientJudge();
    let t = feed(judge, 33, Math.ceil(AMBIENT.graceMs / 33) + 1);
    for (let i = 0; i < 20; i++) {
      t = feed(judge, 1500, 1, t);
      t = feed(judge, 33, 30, t);
    }
    expect(judge.slow).toBe(false);
  });
});
