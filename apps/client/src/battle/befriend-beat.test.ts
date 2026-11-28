import { describe, expect, it } from 'vitest';
import { BEFRIEND_BEAT } from './battle-config.js';
import beatCss from './befriend-beat.css?raw';
import { beatPlan, warmthCue } from './befriend-beat.js';

const layout = {
  spot: { x: 200, y: 300, r: 90 },
  sheetTop: 600,
  pillsBottom: 80,
  width: 393,
  height: 852,
};
const plan = (over: Partial<Parameters<typeof beatPlan>[0]> = {}) =>
  beatPlan({ answer: 'yes', warmth: 2, layout, reducedMotion: false, ...over });

describe('the answer to an ask (#190 PR 6)', () => {
  it('warmth 0–4 grows the blush and the hearts, never shrinks them', () => {
    const cues = [0, 1, 2, 3, 4].map(warmthCue);
    for (let i = 1; i < cues.length; i += 1) {
      expect(cues[i]!.blush).toBeGreaterThanOrEqual(cues[i - 1]!.blush);
      expect(cues[i]!.bursts).toBeGreaterThanOrEqual(cues[i - 1]!.bursts);
    }
    expect(cues[4]!.bursts).toBeGreaterThan(cues[0]!.bursts);
    expect(cues[4]!.blush).toBe(1);
    // Out of range holds at the ends.
    expect(warmthCue(-3)).toEqual(cues[0]);
    expect(warmthCue(99)).toEqual(cues[4]);
  });

  it('the hearts fit the heart pool (a burst is 12 of the 24; bursts are staggered)', () => {
    expect(Math.max(...BEFRIEND_BEAT.bursts)).toBeLessThanOrEqual(3);
    expect(BEFRIEND_BEAT.burstGapMs * 2).toBeGreaterThanOrEqual(700);
  });

  it('the blush glows stronger with more warmth, and is a number only in a style', () => {
    expect(plan({ warmth: 4 }).blush).toBeGreaterThan(plan({ warmth: 0 }).blush);
    expect(plan({ warmth: 4 }).blush).toBeLessThanOrEqual(BEFRIEND_BEAT.blushMax);
    // The page has no text at all: the module builds no text from the warmth.
    expect(JSON.stringify(plan())).not.toMatch(/odds|chance|percent/i);
  });

  it('a yes dims and sparkles; reduced motion keeps the dim and drops the sparkles', () => {
    expect(plan().dim).toBe(true);
    expect(plan().sparkles).toHaveLength(BEFRIEND_BEAT.sparkles);
    expect(plan({ reducedMotion: true }).dim).toBe(true);
    expect(plan({ reducedMotion: true }).sparkles).toHaveLength(0);
    expect(plan({ reducedMotion: true }).ms).toBeLessThan(plan().ms);
  });

  it('a not-yet only blushes', () => {
    const p = plan({ answer: 'not-yet' });
    expect(p.dim).toBe(false);
    expect(p.sparkles).toHaveLength(0);
  });

  it('it is the same each time (a pure plan), and sits mid-screen with no spot', () => {
    expect(plan()).toEqual(plan());
    const none = plan({ layout: { ...layout, spot: null } });
    expect(none.spot.x).toBe(layout.width / 2);
  });

  it('only transform and opacity move, and nothing blocks a tap', () => {
    expect(beatCss).toMatch(/pointer-events:\s*none/);
    const keyframes = beatCss.split('@keyframes').slice(1);
    for (const frames of keyframes) {
      for (const prop of frames.match(/^\s+([a-z-]+):/gm) ?? []) {
        expect(['opacity:', 'transform:']).toContain(prop.trim());
      }
    }
  });
});
