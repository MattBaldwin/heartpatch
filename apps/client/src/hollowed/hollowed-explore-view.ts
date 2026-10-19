import { HOLLOW_RULES, HOME_BASE_RULES, hollowedOpenAt, type WorldPoint } from '@heartpatch/shared';
import { HOLLOWED_EXPLORE } from './hollowed-config.js';

// Exploring a grey village tile (#306 2a), in words and numbers (copy
// follows docs/STYLE_GUIDE.md: short, warm, a little spooky, never scary).
// Pure, so every case is unit-tested; the scene and the screen draw these.

export const HOLLOWED_TEXT = {
  /** The explore header's title on a grey village tile. */
  title: (name: string) => `${name} 🕯️`,
  /** The joy meter under "3 of 12 found 🔍" in the header (its label; the bar shows it). */
  joy: (joy: number) => `Joy ${String(joy)}% ✨`,
  /** An echo nudged the Keeper back: never hurt, just startled. */
  spooked: 'Boo! An echo spooked you back a step 👻',
  /** Nightfall while exploring a village: back to the map. */
  closed: 'Too spooky after dark! Come back in the morning 🌙',
} as const;

/** Is a grey village shut at `minute` past midnight, map time? (Night: the server refuses too.) */
export function villageShut(minute: number): boolean {
  return !hollowedOpenAt({ date: '', minute }, { ...HOME_BASE_RULES, ...HOLLOW_RULES });
}

/** Where an echo is `seconds` into ambient time: a slow, squashed loop round its point. */
export function echoAt(centre: WorldPoint, seconds: number, out: { x: number; z: number }): void {
  const { orbit, lapSeconds } = HOLLOWED_EXPLORE.echo;
  const a = (seconds / lapSeconds) * Math.PI * 2;
  out.x = centre.x + Math.cos(a) * orbit;
  out.z = centre.z + Math.sin(a) * orbit * 0.6;
}

/** How close an echo spooks the Keeper: half as close with a lantern in hand. */
export function spookReach(lantern: boolean): number {
  const { reach, lantern: share } = HOLLOWED_EXPLORE.echo;
  return lantern ? reach * share : reach;
}

/**
 * The Keeper stepped inside an echo's reach: where it's nudged back to
 * (straight away from the echo, `push` past the reach), or null when it's
 * outside. Never a hurt, one step and a line.
 */
export function spookPush(keeper: WorldPoint, echo: WorldPoint, reach: number): WorldPoint | null {
  const dx = keeper.x - echo.x;
  const dz = keeper.z - echo.z;
  const d = Math.hypot(dx, dz);
  if (d > reach) return null;
  const push = HOLLOWED_EXPLORE.echo.push + (reach - d);
  // Right on top of it: back towards the camera (−z), the way the Keeper came.
  if (d < 1e-6) return { x: keeper.x, z: keeper.z - push };
  return { x: keeper.x + (dx / d) * push, z: keeper.z + (dz / d) * push };
}

/** A joy disc's opening 0–1 at `now`, eased out; one already there is open. */
export function discOpening(since: number | null, now: number): number {
  if (since === null) return 1;
  const k = Math.min(1, Math.max(0, (now - since) / HOLLOWED_EXPLORE.joy.growMs));
  return 1 - (1 - k) * (1 - k);
}

/**
 * Spark `i` of a burst `t` (0–1) in: its offset from the spot (world units)
 * and its size. They rise in an arc and fan out, each a little its own way.
 */
export function sparkAt(
  i: number,
  t: number,
  out: { dx: number; dy: number; dz: number; s: number; a: number },
): void {
  const { count, rise, spread, size } = HOLLOWED_EXPLORE.sparks;
  const a = (i / count) * Math.PI * 2 + 0.3;
  const r = 0.25 + (0.75 * ((i * 7) % 5)) / 5;
  out.a = a;
  out.dx = Math.cos(a) * r * t * spread;
  out.dz = Math.sin(a) * r * t * spread;
  out.dy = rise * (t * (2 - t)) * (0.6 + (0.4 * ((i * 3) % 4)) / 4) + 0.15;
  out.s = size * (0.6 + (0.4 * ((i * 5) % 3)) / 3) * Math.sin(Math.PI * Math.min(1, t * 1.2 + 0.1));
}
