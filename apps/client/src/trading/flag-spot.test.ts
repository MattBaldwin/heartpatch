import { describe, expect, it } from 'vitest';
import { flagSpot } from './flag-spot.js';

const flag = { width: 120, height: 26 };
// An iPhone in portrait; the corner buttons end 60px down.
const room = { width: 393, height: 659, top: 60, covers: [] };
const tile = (x: number, y: number) => ({ x, y, width: 40, height: 30 });

describe('flagSpot', () => {
  it('sits over the middle of its tile', () => {
    expect(flagSpot(tile(180, 300), flag, room)).toEqual({ x: 200, y: 300 });
  });

  it('hides with no tile or a tile off screen', () => {
    expect(flagSpot(null, flag, room)).toBeNull();
    expect(flagSpot(tile(-40, 300), flag, room)).toBeNull();
    expect(flagSpot(tile(393, 300), flag, room)).toBeNull();
    expect(flagSpot(tile(180, 659), flag, room)).toBeNull();
  });

  it('keeps to the screen sideways', () => {
    expect(flagSpot(tile(-10, 300), flag, room)?.x).toBe(60);
    expect(flagSpot(tile(370, 300), flag, room)?.x).toBe(333);
  });

  it('never goes up into the top bar (#310)', () => {
    // The tile is just below the bar: the flag is pushed down, not up into it.
    expect(flagSpot(tile(180, 70), flag, room)).toEqual({ x: 200, y: 86 });
    // Its middle is still below the bar: shown, under the bar.
    expect(flagSpot(tile(180, 46), flag, room)?.y).toBe(86);
  });

  it('hides once its tile is mostly under the top bar (#310)', () => {
    // The old clamp pinned this flag to the top of the screen, between the buttons.
    expect(flagSpot(tile(180, 45), flag, room)).toBeNull();
    expect(flagSpot(tile(180, 10), flag, room)).toBeNull();
    expect(flagSpot(tile(180, -20), flag, room)).toBeNull();
  });

  it('hides rather than peek out from under a sheet or the patch name (#310)', () => {
    // A phone's sheet from y=68 down: a flag pushed under the bar would be a sliver.
    const sheet = { x: 8, y: 68, width: 377, height: 580 };
    expect(flagSpot(tile(180, 70), flag, { ...room, covers: [sheet] })).toBeNull();
    // The patch name pill, top middle.
    const name = { x: 130, y: 64, width: 133, height: 44 };
    expect(flagSpot(tile(180, 120), flag, { ...room, covers: [name] })).toBeNull();
    // Clear of both: shown.
    expect(flagSpot(tile(180, 300), flag, { ...room, covers: [name] })).toEqual({ x: 200, y: 300 });
  });

  it('hides beside an iPad side panel it would run under', () => {
    const panel = { x: 760, y: 0, width: 434, height: 834 };
    const wide = { width: 1194, height: 834, top: 60, covers: [panel] };
    expect(flagSpot(tile(700, 400), flag, wide)).toBeNull();
    expect(flagSpot(tile(500, 400), flag, wide)).toEqual({ x: 520, y: 400 });
  });
});
