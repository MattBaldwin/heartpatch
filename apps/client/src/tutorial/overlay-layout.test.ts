import { describe, expect, it } from 'vitest';
import {
  blockersAround,
  holeFor,
  intersects,
  layoutOverlay,
  MIN_HOLE,
  ORB_SIZE,
  placeOrb,
  SPOTLIGHT_PADDING,
  union,
  type Rect,
} from './overlay-layout.js';

const viewport = { width: 390, height: 844 };
const insets = { top: 47, right: 0, bottom: 34, left: 0 };

/** True if (x, y) is inside any of the rects. */
const covered = (rects: readonly Rect[], x: number, y: number) =>
  rects.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);

describe('holeFor', () => {
  it('pads the target', () => {
    const hole = holeFor({ x: 100, y: 200, width: 120, height: 60 }, viewport);
    expect(hole).toEqual({
      x: 100 - SPOTLIGHT_PADDING,
      y: 200 - SPOTLIGHT_PADDING,
      width: 120 + SPOTLIGHT_PADDING * 2,
      height: 60 + SPOTLIGHT_PADDING * 2,
    });
  });

  it('is never smaller than a tap target', () => {
    const hole = holeFor({ x: 100, y: 100, width: 4, height: 4 }, viewport);
    expect(hole?.width).toBe(MIN_HOLE);
    expect(hole?.height).toBe(MIN_HOLE);
  });

  it('stays on screen, and is null for a target off screen', () => {
    const hole = holeFor({ x: -20, y: 820, width: 80, height: 60 }, viewport);
    expect(hole?.x).toBe(0);
    expect((hole?.y ?? 0) + (hole?.height ?? 0)).toBe(viewport.height);
    expect(holeFor({ x: 500, y: 100, width: 40, height: 40 }, viewport)).toBeNull();
  });
});

describe('blockersAround', () => {
  it('covers everything except the hole', () => {
    const hole = { x: 100, y: 300, width: 120, height: 80 };
    const blockers = blockersAround(hole, viewport);
    for (const [x, y] of [
      [10, 10],
      [380, 830],
      [50, 340],
      [300, 340],
      [160, 290],
      [160, 390],
    ] as const) {
      expect(covered(blockers, x, y)).toBe(true);
    }
    expect(covered(blockers, 160, 340)).toBe(false);
    expect(covered(blockers, 100, 300)).toBe(false);
  });

  it('leaves out empty strips when the hole touches an edge', () => {
    expect(blockersAround({ x: 0, y: 0, width: 390, height: 100 }, viewport)).toHaveLength(1);
  });
});

describe('layoutOverlay', () => {
  it('blocks everything while Sprout is just talking', () => {
    const layout = layoutOverlay({
      target: null,
      talkOnly: true,
      viewport,
      insets,
    });
    expect(layout.gate).toBe('blockAll');
    expect(layout.blockers).toEqual([{ x: 0, y: 0, ...viewport }]);
    expect(layout.arrow).toBeNull();
  });

  it('never traps the player on a step that waits for them to play', () => {
    const noTarget = layoutOverlay({ target: null, talkOnly: false, viewport, insets });
    expect(noTarget.gate).toBe('open');
    expect(noTarget.blockers).toHaveLength(0);
  });

  it("never traps the player when a gameplay step's target isn't on screen", () => {
    const layout = layoutOverlay({
      target: null,
      talkOnly: false,
      viewport,
      insets,
    });
    expect(layout.gate).toBe('open');
    expect(layout.blockers).toHaveLength(0);
  });

  it('lets taps through only the spotlight, with the bubble away from it', () => {
    const low = layoutOverlay({
      target: { x: 150, y: 700, width: 90, height: 50 },
      talkOnly: false,
      viewport,
      insets,
    });
    expect(low.gate).toBe('spotlight');
    expect(low.bubble).toBe('top');
    expect(low.arrow).toEqual({ x: 195, y: 700 - SPOTLIGHT_PADDING, points: 'down' });
    expect(covered(low.blockers, 195, 725)).toBe(false);
    expect(covered(low.blockers, 195, 400)).toBe(true);

    const high = layoutOverlay({
      target: { x: 150, y: 100, width: 90, height: 50 },
      talkOnly: false,
      viewport,
      insets,
    });
    expect(high.bubble).toBe('bottom');
    expect(high.arrow?.points).toBe('up');
  });

  it('keeps the arrow off the screen corners', () => {
    const layout = layoutOverlay({
      target: { x: 0, y: 400, width: 20, height: 20 },
      talkOnly: false,
      viewport,
      insets,
    });
    expect(layout.arrow?.x).toBeGreaterThanOrEqual(28);
  });

  it('never puts Sprout over the spotlight, wherever the target is (owner rule)', () => {
    const screens = [
      { viewport: { width: 375, height: 667 }, insets: { top: 20, right: 0, bottom: 0, left: 0 } },
      { viewport, insets },
      {
        viewport: { width: 820, height: 1180 },
        insets: { top: 24, right: 0, bottom: 20, left: 0 },
      },
      {
        viewport: { width: 1180, height: 820 },
        insets: { top: 24, right: 0, bottom: 20, left: 0 },
      },
    ];
    const bubbles = [
      { size: { width: 460, height: 190 }, tucked: false },
      { size: { width: 460, height: 320 }, tucked: false }, // a long line, a name box
      { size: { width: 200, height: 48 }, tucked: true },
    ];
    for (const screen of screens) {
      const { width, height } = screen.viewport;
      // Targets all over the screen, including tray handles on both edges.
      for (let y = 0; y < height; y += 37) {
        for (const target of [
          { x: 0, y, width: 96, height: 94 },
          { x: width - 96, y, width: 96, height: 94 },
          { x: width / 2 - 60, y, width: 120, height: 48 },
        ]) {
          for (const { size, tucked } of bubbles) {
            const layout = layoutOverlay({
              target,
              talkOnly: false,
              ...screen,
              bubbleSize: size,
              tucked,
            });
            const label = JSON.stringify({ screen: screen.viewport, target, size, tucked });
            expect(layout.hole, label).not.toBeNull();
            expect(intersects(layout.bubbleRect!, layout.hole!), label).toBe(false);
            // And it stays on screen.
            expect(layout.bubbleRect!.x, label).toBeGreaterThanOrEqual(0);
            expect(layout.bubbleRect!.y, label).toBeGreaterThanOrEqual(0);
            expect(layout.bubbleRect!.x + layout.bubbleRect!.width, label).toBeLessThanOrEqual(
              width,
            );
            expect(layout.bubbleRect!.y + layout.bubbleRect!.height, label).toBeLessThanOrEqual(
              height,
            );
          }
        }
      }
    }
  });

  it('only guides at a target that takes more than one tap (#140): lit, pointed at, never gated', () => {
    const layout = layoutOverlay({
      target: { x: 294, y: 417, width: 96, height: 94 },
      talkOnly: false,
      viewport,
      insets,
      soft: true,
    });
    expect(layout.gate).toBe('guide');
    expect(layout.hole).not.toBeNull();
    expect(layout.arrow).not.toBeNull();
    expect(layout.blockers).toEqual([]);
    expect(intersects(layout.bubbleRect!, layout.hole!)).toBe(false);
  });

  it('peeks over a bottom sheet from the top, clear of it, gating nothing', () => {
    // The Hollow's morning report: a card at the foot of the screen.
    const report: Rect = { x: 16, y: 560, width: 358, height: 200 };
    const layout = layoutOverlay({
      target: null,
      talkOnly: false,
      viewport,
      insets,
      bubbleSize: { width: 358, height: 260 },
      avoid: report,
    });
    expect(layout.gate).toBe('open');
    expect(layout.blockers).toEqual([]);
    expect(layout.hole).toBeNull();
    expect(layout.bubbleRect).not.toBeNull();
    expect(intersects(layout.bubbleRect!, report)).toBe(false);
    expect(layout.bubble).toBe('top');
  });

  it('peeks over a sheet that fills the phone from the far edge, never shrunk away', () => {
    const care: Rect = { x: 0, y: 0, width: 390, height: 844 };
    const layout = layoutOverlay({
      target: null,
      talkOnly: false,
      viewport,
      insets,
      bubbleSize: { width: 358, height: 260 },
      avoid: care,
    });
    expect(layout.bubbleRect?.height).toBe(260);
    expect(layout.bubbleRect?.y).toBe(insets.top + 16);
  });

  it('moves the bubble beside a tall target that leaves no room above or below', () => {
    const layout = layoutOverlay({
      target: { x: 10, y: 60, width: 120, height: 720 },
      talkOnly: false,
      viewport,
      insets,
      bubbleSize: { width: 358, height: 160 },
    });
    expect(intersects(layout.bubbleRect!, layout.hole!)).toBe(false);
    expect(layout.bubbleRect!.x).toBeGreaterThan(layout.hole!.x + layout.hole!.width);
  });

  it('leaves the bubble to the stylesheet when there is no spotlight', () => {
    const layout = layoutOverlay({ target: null, talkOnly: true, viewport, insets });
    expect(layout.bubbleRect).toBeNull();
  });

  it('tucks the chip just above the spotlight, not into the corner buttons', () => {
    // The handle at 55% of a small phone, and a chip too tall for its 38% spot.
    const layout = layoutOverlay({
      target: { x: 0, y: 320, width: 96, height: 94 },
      talkOnly: false,
      viewport: { width: 375, height: 667 },
      insets: { top: 20, right: 0, bottom: 0, left: 0 },
      bubbleSize: { width: 173, height: 66 },
      tucked: true,
    });
    expect(intersects(layout.bubbleRect!, layout.hole!)).toBe(false);
    expect(layout.bubbleRect!.y + layout.bubbleRect!.height).toBe(layout.hole!.y - 16);
  });
});

describe('placeOrb (Sprout waiting behind a sheet, #139)', () => {
  const screen = { viewport, insets };
  const onScreen = (orb: Rect) => {
    expect(orb.width).toBe(ORB_SIZE);
    expect(orb.height).toBe(ORB_SIZE);
    expect(orb.x).toBeGreaterThanOrEqual(insets.left);
    expect(orb.y).toBeGreaterThanOrEqual(insets.top);
    expect(orb.x + orb.width).toBeLessThanOrEqual(viewport.width - insets.right);
    expect(orb.y + orb.height).toBeLessThanOrEqual(viewport.height - insets.bottom);
  };

  it('takes the top-left corner when nothing is there', () => {
    const orb = placeOrb({ ...screen, obstacles: [] });
    onScreen(orb);
    expect(orb).toEqual({ x: 8, y: insets.top + 8, width: ORB_SIZE, height: ORB_SIZE });
  });

  it('keeps clear of every control and card on screen', () => {
    // The map's corner buttons, the tile chip at the bottom, both tray handles.
    const obstacles: Rect[] = [
      { x: 12, y: 50, width: 150, height: 56 },
      { x: 330, y: 50, width: 48, height: 48 },
      { x: 12, y: 700, width: 366, height: 132 },
      { x: 0, y: 417, width: 96, height: 94 },
      { x: 294, y: 417, width: 96, height: 94 },
    ];
    const orb = placeOrb({ ...screen, obstacles });
    onScreen(orb);
    for (const o of obstacles) expect(intersects(orb, o), JSON.stringify(orb)).toBe(false);
  });

  it('covers as little as it can when a sheet fills the phone', () => {
    const card: Rect = { x: 16, y: 60, width: 358, height: 760 };
    const buttons: Rect[] = [
      { x: 36, y: 330, width: 100, height: 100 },
      { x: 36, y: 640, width: 318, height: 56 },
    ];
    const orb = placeOrb({ ...screen, obstacles: [card, ...buttons] });
    onScreen(orb);
    for (const b of buttons) expect(intersects(orb, b), JSON.stringify(orb)).toBe(false);
  });

  it('stays inside the safe area on a wide screen', () => {
    const orb = placeOrb({
      viewport: { width: 1180, height: 820 },
      insets: { top: 24, right: 44, bottom: 20, left: 44 },
      obstacles: [{ x: 44, y: 24, width: 200, height: 80 }],
    });
    expect(orb.x).toBeGreaterThanOrEqual(44);
    expect(intersects(orb, { x: 44, y: 24, width: 200, height: 80 })).toBe(false);
  });
});

describe('union', () => {
  it('is the smallest rect holding every rect, or null for none', () => {
    expect(union([])).toBeNull();
    expect(
      union([
        { x: 10, y: 20, width: 30, height: 40 },
        { x: 0, y: 50, width: 20, height: 20 },
      ]),
    ).toEqual({ x: 0, y: 20, width: 40, height: 50 });
  });
});
