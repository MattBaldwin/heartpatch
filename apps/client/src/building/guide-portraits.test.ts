import { describe, expect, it, vi } from 'vitest';
import type { BuildingPortraitLook } from '../procedural/portraits.js';
import { askPortrait } from '../works/works-card.js';
import { GUIDE_PORTRAIT_TRIES, lazyAsks, type NearScreen } from './guide-portraits.js';

/** A stand-in IntersectionObserver: `near(t)` is a card scrolling into view. */
function fakeScreen() {
  let near: (t: string) => void = () => undefined;
  const watched = new Set<string>();
  const screen: NearScreen<string> = {
    observe: (t) => watched.add(t),
    unobserve: (t) => watched.delete(t),
  };
  return {
    factory: (n: (t: string) => void) => {
      near = n;
      return screen;
    },
    watched,
    near: (t: string) => {
      near(t);
    },
  };
}
const root = {} as Element;

describe('the guide asks for a picture only near the screen (#715)', () => {
  it('asks once per card, as it comes near, never for the rest', () => {
    const screen = fakeScreen();
    const start = vi.fn();
    const asks = lazyAsks<string, number>(screen.factory, root, start);
    for (let i = 0; i < 35; i++) asks.add(`card${String(i)}`, i);
    expect(start).not.toHaveBeenCalled();
    expect(screen.watched.size).toBe(35);
    screen.near('card0');
    screen.near('card1');
    screen.near('card0'); // seen again: already asked
    expect(start.mock.calls).toEqual([
      ['card0', 0],
      ['card1', 1],
    ]);
    expect(screen.watched.has('card0')).toBe(false);
    // A redrawn list forgets the cards it hadn't asked for.
    asks.reset();
    expect(screen.watched.size).toBe(0);
    screen.near('card5');
    expect(start).toHaveBeenCalledTimes(2);
  });
});

describe('askPortrait retries until drawn, with a cap (#715)', () => {
  const look: BuildingPortraitLook = {
    buildingId: 'waystation',
    level: 1,
    asleep: false,
    size: 64,
  };

  it('keeps asking past a few busy draws', async () => {
    const building = vi.fn().mockResolvedValue('data:image/png;x');
    for (let i = 0; i < GUIDE_PORTRAIT_TRIES - 1; i++) building.mockResolvedValueOnce(null);
    const show = vi.fn();
    expect(await askPortrait({ building }, look, show, 0, GUIDE_PORTRAIT_TRIES)).toBe(true);
    expect(building).toHaveBeenCalledTimes(GUIDE_PORTRAIT_TRIES);
    expect(show).toHaveBeenCalledWith('data:image/png;x');
  });

  it('stops at the cap with no engine to draw', async () => {
    const building = vi.fn().mockResolvedValue(null);
    const show = vi.fn();
    expect(await askPortrait({ building }, look, show, 0, GUIDE_PORTRAIT_TRIES)).toBe(false);
    expect(building).toHaveBeenCalledTimes(GUIDE_PORTRAIT_TRIES);
    expect(show).not.toHaveBeenCalled();
  });
});
