import { describe, expect, it } from 'vitest';
import { flagSpot } from './flag-spot.js';

const flag = { width: 120, height: 26 };
// An iPhone in portrait; the corner buttons end 60px down.
const room = { width: 393, height: 659, top: 60 };
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
});
