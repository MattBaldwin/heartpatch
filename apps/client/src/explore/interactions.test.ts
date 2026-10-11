import { describe, expect, it } from 'vitest';
import { INTERACTION } from './explore-config.js';
import {
  interactionProgress,
  lit,
  netGlowing,
  startInteraction,
  stepInteraction,
  type InteractionInput,
  type InteractionState,
} from './interactions.js';
import type { SpotInteraction } from '@heartpatch/shared';

const STAGE = { width: 300, height: 240 };

function run(kind: SpotInteraction, inputs: readonly InteractionInput[], seed = 0.5) {
  return inputs.reduce<InteractionState>(
    (s, input) => stepInteraction(s, input),
    startInteraction(kind, STAGE, 0, seed),
  );
}

/** A straight drag from one point to another in a few moves. */
function drag(x0: number, y0: number, x1: number, y1: number, t = 0): InteractionInput[] {
  const steps = 4;
  const moves: InteractionInput[] = [];
  for (let i = 1; i <= steps; i++) {
    moves.push({
      type: 'move',
      x: x0 + ((x1 - x0) * i) / steps,
      y: y0 + ((y1 - y0) * i) / steps,
      t,
    });
  }
  return [{ type: 'down', x: x0, y: y0, t }, ...moves, { type: 'up', x: x1, y: y1, t }];
}

describe('Shovel: swipe down to dig', () => {
  it('takes one scoop per downward swipe', () => {
    const one = run('dig', drag(150, 40, 150, 140));
    expect(one.count).toBe(1);
    expect(one.done).toBe(false);
    expect(interactionProgress(one)).toBeCloseTo(1 / INTERACTION.digScoops);
    const all = run(
      'dig',
      Array.from({ length: INTERACTION.digScoops }, () => drag(150, 40, 150, 140)).flat(),
    );
    expect(all.done).toBe(true);
  });

  it('ignores swipes up and tiny wiggles', () => {
    expect(run('dig', drag(150, 140, 150, 40)).count).toBe(0);
    expect(run('dig', drag(150, 40, 150, 40 + INTERACTION.swipePx / 2)).count).toBe(0);
  });

  it('digs by tapping too (the easy way)', () => {
    const taps = Array.from({ length: INTERACTION.digScoops }, (_, i) => ({
      type: 'easy' as const,
      t: i,
    }));
    expect(run('dig', taps).done).toBe(true);
  });
});

describe('Rope: tap-tap to climb', () => {
  it('climbs on alternating hands only', () => {
    const same = run('climb', [
      { type: 'side', side: 'left', t: 0 },
      { type: 'side', side: 'left', t: 1 },
    ]);
    expect(same.count).toBe(1);
    const sides = Array.from({ length: INTERACTION.climbSteps }, (_, i) => ({
      type: 'side' as const,
      side: i % 2 === 0 ? ('left' as const) : ('right' as const),
      t: i,
    }));
    expect(run('climb', sides).done).toBe(true);
  });

  it('climbs all the way when the easy button is held', () => {
    const half = run('climb', [
      { type: 'easy-down', t: 0 },
      { type: 'tick', t: INTERACTION.holdMs / 2 },
    ]);
    expect(half.done).toBe(false);
    expect(interactionProgress(half)).toBeCloseTo(0.5);
    const letGo = stepInteraction(half, { type: 'easy-up', t: INTERACTION.holdMs / 2 });
    expect(interactionProgress(letGo)).toBe(0);
    expect(stepInteraction(half, { type: 'tick', t: INTERACTION.holdMs }).done).toBe(true);
  });
});

describe('Lantern: light the cave', () => {
  it('finds the glint when the light passes over it, then a tap on it searches', () => {
    const start = startInteraction('light', STAGE, 0, 0.25);
    const { x, y } = start.glint;
    const dark = stepInteraction(start, { type: 'down', x: 5, y: 5, t: 0 });
    expect(dark.revealed).toBe(false);
    expect(lit(dark, x, y)).toBe(false);
    const found = stepInteraction(dark, { type: 'move', x, y, t: 1 });
    expect(found.revealed).toBe(true);
    expect(found.done).toBe(false);
    expect(stepInteraction(found, { type: 'down', x, y, t: 2 }).done).toBe(true);
  });

  it('lights the whole cave the easy way', () => {
    const easy = run('light', [{ type: 'easy', t: 0 }]);
    expect(easy.revealed).toBe(true);
    expect(lit(easy, 0, 0)).toBe(true);
    expect(stepInteraction(easy, { type: 'down', ...easy.glint, t: 1 }).done).toBe(true);
  });

  it('hides the glint in the same place for the same spot', () => {
    expect(startInteraction('light', STAGE, 0, 0.7).glint).toEqual(
      startInteraction('light', STAGE, 99, 0.7).glint,
    );
  });
});

describe('Net: swipe when it glows', () => {
  it('scoops on any swipe, with a bigger splash while it glows', () => {
    const glowing = run('scoop', drag(40, 120, 260, 120, 10));
    expect(glowing.done).toBe(true);
    expect(glowing.bigSplash).toBe(true);
    const dim = run('scoop', drag(40, 120, 260, 120, INTERACTION.netGlowMs + 10));
    expect(dim.done).toBe(true);
    expect(dim.bigSplash).toBe(false);
  });

  it('glows on a cycle', () => {
    const s = startInteraction('scoop', STAGE, 1000);
    expect(netGlowing(s, 1000)).toBe(true);
    expect(netGlowing(s, 1000 + INTERACTION.netGlowMs + 1)).toBe(false);
    expect(netGlowing(s, 1000 + INTERACTION.netCycleMs)).toBe(true);
  });

  it('scoops any time the easy way', () => {
    expect(run('scoop', [{ type: 'easy', t: 5 }]).done).toBe(true);
  });
});

describe('Hands', () => {
  it('lifts a rock after a long enough hold, not a short one', () => {
    const short = run('lift', [
      { type: 'down', x: 1, y: 1, t: 0 },
      { type: 'tick', t: INTERACTION.holdMs - 100 },
      { type: 'up', x: 1, y: 1, t: INTERACTION.holdMs - 100 },
      { type: 'tick', t: INTERACTION.holdMs + 100 },
    ]);
    expect(short.done).toBe(false);
    const long = run('lift', [
      { type: 'down', x: 1, y: 1, t: 0 },
      { type: 'tick', t: INTERACTION.holdMs },
    ]);
    expect(long.done).toBe(true);
    expect(run('lift', [{ type: 'easy', t: 0 }]).done).toBe(true);
  });

  it('shakes a tree by wiggling left and right', () => {
    const wiggle: InteractionInput[] = [{ type: 'down', x: 150, y: 100, t: 0 }];
    let x = 150;
    for (let i = 0; i <= INTERACTION.shakes; i++) {
      x += i % 2 === 0 ? 60 : -60;
      wiggle.push({ type: 'move', x, y: 100, t: i });
    }
    expect(run('shake', wiggle).done).toBe(true);
    // One long drag one way isn't a shake.
    expect(run('shake', drag(20, 100, 280, 100)).count).toBe(0);
    expect(run('shake', [{ type: 'easy', t: 0 }]).done).toBe(true);
  });
});

it('stays done once done', () => {
  const done = run('lift', [{ type: 'easy', t: 0 }]);
  expect(stepInteraction(done, { type: 'down', x: 0, y: 0, t: 1 })).toBe(done);
});

describe('Snorkel at a bubble spring: tap to catch the bubbles (#335)', () => {
  const tap = (x: number, t = 0): InteractionInput[] => [
    { type: 'down', x, y: 120, t },
    { type: 'up', x, y: 120, t },
  ];

  it('catches a bubble with each tap', () => {
    const one = run('dive', tap(100));
    expect(one.count).toBe(1);
    expect(one.done).toBe(false);
    const all = run(
      'dive',
      Array.from({ length: INTERACTION.diveBubbles }, (_, i) => tap(60 + i * 40)).flat(),
    );
    expect(all.done).toBe(true);
  });

  it('counts each easy tap, and a long hold catches them all', () => {
    expect(run('dive', [{ type: 'easy', t: 0 }]).count).toBe(1);
    const held = run('dive', [
      { type: 'easy-down', t: 0 },
      { type: 'tick', t: INTERACTION.holdMs + 1 },
    ]);
    expect(held.done).toBe(true);
    const letGo = run('dive', [
      { type: 'easy-down', t: 0 },
      { type: 'easy-up', t: 100 },
      { type: 'tick', t: INTERACTION.holdMs + 1 },
    ]);
    expect(letGo.done).toBe(false);
  });
});

describe('Snorkel at a reed bed: swipe the reeds apart (#335)', () => {
  it('counts each sideways swipe, either way, once', () => {
    const right = run('part', drag(60, 120, 220, 120));
    expect(right.count).toBe(1);
    expect(right.done).toBe(false);
    // A swipe right, then a separate swipe left, parts them.
    expect(run('part', [...drag(60, 120, 220, 120), ...drag(220, 120, 60, 120)]).done).toBe(true);
    // Two swipes the same way do too.
    expect(run('part', [...drag(60, 120, 220, 120), ...drag(60, 120, 220, 120)]).done).toBe(true);
  });

  it('ignores up-and-down swipes and tiny wiggles, and parts in one easy tap', () => {
    expect(run('part', drag(150, 40, 150, 200)).count).toBe(0);
    expect(run('part', drag(150, 120, 150 + INTERACTION.swipePx / 2, 120)).count).toBe(0);
    expect(run('part', [{ type: 'easy', t: 0 }]).done).toBe(true);
  });
});
