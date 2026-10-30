import { describe, expect, it } from 'vitest';
import { hudSpot } from './hud-place.js';

describe('hudSpot', () => {
  it('an iPhone 15 on its side: centred on the screen, in the gap', () => {
    // "My patches" ends at 131, the round buttons start at 592 (852 wide).
    expect(hudSpot(131, 592, 226, 852)).toEqual({ x: 426, room: 445, half: 113 });
  });

  it('an iPhone SE on its side: slides left of centre to clear the round buttons', () => {
    // The gap is 131 to 407 (667 wide): centred, a 226px pill would reach 446.
    const spot = hudSpot(131, 407, 226, 667)!;
    expect(spot.room).toBe(260);
    expect(spot.x + spot.half).toBe(399);
    expect(spot.x - spot.half).toBeGreaterThanOrEqual(139);
  });

  it('a pill wider than the gap fills it (its name shortens with …)', () => {
    expect(hudSpot(131, 407, 319, 667)).toEqual({ x: 269, room: 260, half: 130 });
  });

  it('stays put when the gap is too narrow for the name and coins', () => {
    expect(hudSpot(131, 300, 226, 667)).toBeNull();
  });
});
