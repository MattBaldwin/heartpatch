import { describe, expect, it } from 'vitest';
import { flagBox, flagSpot, keeperCover, keeperTile } from './flag-spot.js';

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
    // The patch name pill, top middle: over its tile the flag would run
    // under it, so it hangs under the tile instead (#426).
    const name = { x: 130, y: 64, width: 133, height: 44 };
    expect(flagSpot(tile(180, 120), flag, { ...room, covers: [name] })).toEqual({ x: 200, y: 176 });
    // A taller cover reaching past the tile too: hidden.
    const tall = { ...name, height: 120 };
    expect(flagSpot(tile(180, 120), flag, { ...room, covers: [tall] })).toBeNull();
    // Clear of both: shown.
    expect(flagSpot(tile(180, 300), flag, { ...room, covers: [name] })).toEqual({ x: 200, y: 300 });
  });

  it('hides beside an iPad side panel it would run under', () => {
    const panel = { x: 760, y: 0, width: 434, height: 834 };
    const wide = { width: 1194, height: 834, top: 60, covers: [panel] };
    expect(flagSpot(tile(700, 400), flag, wide)).toBeNull();
    expect(flagSpot(tile(500, 400), flag, wide)).toEqual({ x: 520, y: 400 });
  });

  it('hangs under its tile when the tray handles leave no room beside them (#426)', () => {
    // A 320-wide phone: the Adventure and Home handles 87px and 84px wide, side
    // by side at the tile's height, with 149px between them for a 185px flag.
    const small = { width: 320, height: 568, top: 60, covers: [] };
    const handles = [
      { x: 0, y: 265, width: 87, height: 94 },
      { x: 236, y: 265, width: 84, height: 94 },
    ];
    const wide = { width: 185, height: 24 };
    const post = { x: 140, y: 334, width: 40, height: 30 };
    expect(flagSpot(post, wide, { ...small, covers: handles })).toEqual({ x: 160, y: 388 });
    // Clear of the handles over its tile: it stays over it.
    expect(flagSpot({ ...post, y: 400 }, wide, { ...small, covers: handles })).toEqual({
      x: 160,
      y: 400,
    });
  });

  it('never covers my Keeper (#426)', () => {
    const keeper = { x: 170, y: 250, width: 40, height: 60 };
    // Over its tile it would sit on my Keeper: it hangs under the tile instead.
    expect(flagSpot(tile(180, 300), flag, { ...room, covers: [keeper] })).toEqual({
      x: 200,
      y: 356,
    });
  });

  it('hides when neither over nor under its tile is clear (#426)', () => {
    const band = { x: 0, y: 250, width: 393, height: 130 };
    expect(flagSpot(tile(180, 300), flag, { ...room, covers: [band] })).toBeNull();
    // Under it would run off the bottom of the screen.
    const above = { x: 0, y: 580, width: 393, height: 40 };
    expect(flagSpot(tile(180, 620), flag, { ...room, covers: [above] })).toBeNull();
  });
});

describe('keeperCover', () => {
  it('reaches up and right of my Heart Seed, where my Keeper stands (#426)', () => {
    const seed = { x: 100, y: 200, width: 40, height: 30 };
    expect(keeperCover(seed)).toEqual({ x: 100, y: 170, width: 60, height: 60 });
  });

  it('keeps a flag off my Keeper (#426)', () => {
    const seed = { x: 180, y: 300, width: 40, height: 30 };
    const covers = [keeperCover(seed)];
    // Just below home: over its tile it would reach up onto my Keeper's
    // tile, so it hangs under its tile instead.
    expect(flagSpot(tile(190, 340), flag, { ...room, covers })).toEqual({ x: 210, y: 396 });
    // Beside my Keeper's head: neither spot is clear, so it hides.
    expect(flagSpot(tile(190, 280), flag, { ...room, covers })).toBeNull();
    // Well above home: clear, over its tile.
    expect(flagSpot(tile(190, 200), flag, { ...room, covers })).toEqual({ x: 210, y: 200 });
  });
});

describe('my own home flag (#306)', () => {
  it("stretches my Heart Seed's tile up over my Keeper's head", () => {
    const seed = { x: 100, y: 200, width: 40, height: 30 };
    expect(keeperTile(seed)).toEqual({ x: 100, y: 170, width: 40, height: 60 });
  });

  it('flies above my Keeper, clear of their cover, centred on the seed', () => {
    const seed = { x: 180, y: 300, width: 40, height: 30 };
    const covers = [keeperCover(seed)];
    const spot = flagSpot(keeperTile(seed), flag, { ...room, covers });
    expect(spot).toEqual({ x: 200, y: 270 });
    // A fractional seed (as the camera draws it) still clears my Keeper's cover.
    const odd = { x: 161.04, y: 308.3, width: 52.92, height: 38.7 };
    const at = flagSpot(
      keeperTile(odd),
      { width: 135, height: 24 },
      {
        ...room,
        covers: [keeperCover(odd)],
      },
    );
    expect(at?.y).toBe(269);
    // Over the plain seed tile it would sit on my Keeper, so it hangs under instead.
    expect(flagSpot(seed, flag, { ...room, covers })).toEqual({ x: 200, y: 356 });
  });
});

describe('flags keep clear of each other (#306)', () => {
  it("covers exactly the flag's box at its spot", () => {
    expect(flagBox({ x: 200, y: 300 }, flag)).toEqual({ x: 140, y: 274, width: 120, height: 26 });
  });

  it('puts a second flag on the same spot under its tile, or hides it, never on top', () => {
    const first = flagSpot(tile(180, 300), flag, room);
    if (!first) throw new Error('no spot');
    const covers = [flagBox(first, flag)];
    const second = flagSpot(tile(190, 305), flag, { ...room, covers });
    expect(second).toEqual({ x: 210, y: 361 });
    if (!second) throw new Error('no spot');
    const third = flagSpot(tile(185, 302), flag, {
      ...room,
      covers: [...covers, flagBox(second, flag)],
    });
    expect(third).toBeNull();
  });
});
