import { expect, type Page } from '@playwright/test';
import { hook } from './dev-hook.js';
import { realTapAt } from './touch.js';

// Walking the Keeper round an explored tile in specs (#291): tap the ground on
// the way to a spot until it's in front. Shared by explore.spec.ts and
// lorebook.spec.ts.

type Point = { x: number; y: number };
type ExploreHook = {
  explore?: () => {
    keeper: { x: number; z: number };
    pointOnScreen: (p: { x: number; z: number }) => Point | null;
  };
};

/** What walking reads from the explore view's dev hook (`ExploreDebug`). */
interface WalkState {
  near: number | null;
  keeper: { x: number; z: number };
  spots: { index: number; x: number; z: number }[];
}

const exploreState = (page: Page) => hook<WalkState>(page, 'explore');

/**
 * A point on the ground to tap on the way from the Keeper to a tile-local
 * spot: the spot itself if a tap there reaches the ground, else part way
 * there, else a little to one side (the controls and the hint cover parts
 * of the screen). Null when nothing on the way can be tapped.
 */
export function waypoint(page: Page, to: { x: number; z: number }): Promise<Point | null> {
  return page.evaluate((spot) => {
    const e = (window as unknown as { __heartpatch?: ExploreHook }).__heartpatch?.explore?.();
    if (!e) return null;
    const ground = document.querySelector('[data-testid="explore-ground"]');
    const k = e.keeper;
    const dx = spot.x - k.x;
    const dz = spot.z - k.z;
    for (const turn of [0, 0.6, -0.6, 1.2, -1.2]) {
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      for (const f of [1, 0.75, 0.5, 0.35, 0.2]) {
        const p = { x: k.x + (dx * c - dz * s) * f, z: k.z + (dx * s + dz * c) * f };
        const at = e.pointOnScreen(p);
        if (at && document.elementFromPoint(at.x, at.y) === ground) return at;
      }
    }
    return null;
  }, to);
}

/** Waits until the Keeper stops walking. */
export async function keeperStill(page: Page): Promise<void> {
  let last = '';
  await expect
    .poll(
      async () => {
        const now = JSON.stringify((await exploreState(page))?.keeper);
        const still = now === last;
        last = now;
        return still;
      },
      { timeout: 60_000, intervals: [500] },
    )
    .toBe(true);
}

/**
 * Walks up to a spot by tapping: the spot itself once a tap there reaches
 * the ground, else the ground on the way to it (the camera follows). True
 * once it (or any spot in `orAny`) is in front; false if taps can't get
 * there (tap-to-walk slides round one rock at a time, it doesn't path round
 * a cluster: a player steers round with the joystick).
 */
export async function walkTo(
  page: Page,
  index: number,
  orAny: readonly number[] = [],
): Promise<boolean> {
  const done = (near: number | null | undefined) =>
    near === index || (near != null && orAny.includes(near));
  for (let tries = 0; tries < 10; tries++) {
    const state = (await exploreState(page))!;
    if (done(state.near)) return true;
    const spot = state.spots.find((s) => s.index === index)!;
    const tap = await waypoint(page, spot);
    if (!tap) return false;
    await realTapAt(page, tap.x, tap.y);
    await keeperStill(page);
  }
  return done((await exploreState(page))?.near);
}

/** Spots by how far they are from the Keeper, nearest first. */
export function nearestFirst<T extends { x: number; z: number }>(
  spots: T[],
  from: { x: number; z: number },
): T[] {
  const d = (s: T) => (s.x - from.x) ** 2 + (s.z - from.z) ** 2;
  return [...spots].sort((a, b) => d(a) - d(b));
}
