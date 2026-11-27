import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PATCH_BAR,
  PATCH_BAR_TEXT,
  barFromEvent,
  newerBar,
  patchBarFull,
  patchBarLabel,
  patchBarPercent,
  patchBarVars,
  type PatchBarState,
} from './patch-bar.js';

const bar = (
  chipped: number,
  goal = 200,
  state: PatchBarState['state'] = 'open',
): PatchBarState => ({
  goal,
  chipped,
  state,
});

// Vitest blanks imported CSS, so the sheet is read as text.
const patchCss = readFileSync(new URL('./patch-bar.css', import.meta.url), 'utf8');

describe('patchBarPercent', () => {
  it('rounds chipped / goal to steps of 5', () => {
    expect(patchBarPercent(bar(80))).toBe(40);
    expect(patchBarPercent(bar(81))).toBe(40); // 40.5
    expect(patchBarPercent(bar(84))).toBe(40); // 42 rounds down
    expect(patchBarPercent(bar(86))).toBe(45); // 43 rounds up
    expect(patchBarPercent(bar(100))).toBe(50);
  });
  it('is 0 only with nothing chipped, and moves after any chip', () => {
    expect(patchBarPercent(bar(0))).toBe(0);
    expect(patchBarPercent(bar(1, 1200))).toBe(PATCH_BAR.stepPercent);
  });
  it('never reads 100 until the bar is full', () => {
    expect(patchBarPercent(bar(199))).toBe(95);
    expect(patchBarFull(bar(199))).toBe(false);
  });
  it('is 100 once full, and clamps when chipped passes goal after the fall', () => {
    expect(patchBarPercent(bar(200))).toBe(100);
    expect(patchBarPercent(bar(340, 200, 'fell'))).toBe(100);
    expect(patchBarFull(bar(340, 200, 'fell'))).toBe(true);
  });
  it('stays in range for odd input', () => {
    expect(patchBarPercent(bar(-5))).toBe(0);
    expect(patchBarPercent(bar(5, 0))).toBe(100);
  });
});

describe('patchBarLabel', () => {
  it('says the percent for a screen reader', () => {
    expect(patchBarLabel(bar(80))).toBe('Patch bar, 40 percent');
  });
  it('says full when full', () => {
    expect(patchBarLabel(bar(200))).toBe('Patch bar, full');
  });
});

describe('newerBar', () => {
  it('takes the one with more chipped, whichever arrived last', () => {
    expect(newerBar(bar(100), bar(60))).toEqual(bar(100));
    expect(newerBar(bar(60), bar(100))).toEqual(bar(100));
    expect(newerBar(null, bar(60))).toEqual(bar(60));
  });
  it('keeps a dozed-off bar dozed against an older live copy, in either order', () => {
    const dozed = bar(150, 200, 'dozed');
    const live = bar(150, 200, 'open');
    expect(newerBar(dozed, live).state).toBe('dozed');
    expect(newerBar(live, dozed).state).toBe('dozed');
    expect(newerBar(live, bar(120, 200, 'dozed')).state).toBe('dozed');
  });
  it('keeps a fall a fall', () => {
    const fell = bar(210, 200, 'fell');
    expect(newerBar(fell, bar(220, 200, 'open')).state).toBe('fell');
  });
});

describe('barFromEvent', () => {
  it('reads a full bar as fallen and the rest as open', () => {
    expect(barFromEvent({ chipped: 120, goal: 200 }).state).toBe('open');
    expect(barFromEvent({ chipped: 200, goal: 200 }).state).toBe('fell');
    expect(barFromEvent({ chipped: 230, goal: 200 }).state).toBe('fell');
  });
});

describe('the line is one config-driven style', () => {
  it('sets its numbers from PATCH_BAR as custom properties', () => {
    expect(patchBarVars()).toMatchObject({
      '--patch-bar-h': `${String(PATCH_BAR.lineHeight)}px`,
      '--patch-bar-gap': `${String(PATCH_BAR.gap)}px`,
    });
    expect(PATCH_BAR.lineHeight).toBe(4);
  });
  it('has no per-size override: no media query changes its place (phone, landscape, iPad alike)', () => {
    expect(patchCss).not.toMatch(/@media\s*\([^)]*(width|orientation)/);
  });
  it('is gold when full, and still under reduced motion', () => {
    expect(patchCss).toMatch(/\.patch-bar-full \.patch-bar-fill/);
    expect(patchCss).toMatch(/prefers-reduced-motion: reduce/);
  });
  it('sets no text under the 14 px floor', () => {
    const sizes = [...patchCss.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14);
  });
});

describe('words', () => {
  it('puts the ❄ and the percentage off the line, on the card and sticker', () => {
    expect(PATCH_BAR_TEXT.percent(45)).toBe('❄ 45%');
    expect(PATCH_BAR_TEXT.youChipped(38)).toBe('You chipped in 38!');
    expect(PATCH_BAR_TEXT.youChipped(0)).toBe('You helped!');
  });
  it('never says boss or enemy to a player', () => {
    for (const text of Object.values(PATCH_BAR_TEXT)) {
      const sample = typeof text === 'function' ? text(1) : text;
      expect(sample).not.toMatch(/boss|enemy/i);
    }
  });
});
