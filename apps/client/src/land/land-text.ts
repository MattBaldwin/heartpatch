import {
  hexDistance,
  hexKey,
  type Hex,
  type HexKey,
  type LandTending,
  type PublicTile,
} from '@heartpatch/shared';

// Land that misses you (owner decision 2026-10-06, design review Q2): the
// words and the little marks on the map, as the owner approved them in the
// mockup. Pure, so the wording is unit-tested and scanned for avoided words
// (style guide §1, §2, §9: cozy, short, never scolding).

export const LAND_TEXT = {
  chip: 'Some land misses you!',
  visit: 'Visit',
  happy: 'Your land is so happy to see you! 💕',
  missesTitle: 'This land misses you! 💛',
  missesLine: 'Nobody has visited it in a while. Pop by and it stays yours!',
  wildTitle: 'Wild again! 🌱',
  wildLine: 'This was your land. Its guardians grew back while you were away.',
  welcomeTitle: 'Welcome back!',
  welcomeLine: (n: number) =>
    n === 1
      ? 'While you were away, 1 bit of land went wild again.'
      : `While you were away, ${String(n)} bits of land went wild again.`,
  welcomeClaim: (n: number) =>
    n === 1
      ? 'Its guardians are back. You can claim it again!'
      : 'Their guardians are back. You can claim them again!',
  /** My fires came down with the land (#202): what came back is shown under it. */
  welcomeFire: (n: number) =>
    n === 1
      ? 'Your fire out there went out when the land went wild. You got some things back 🔥'
      : `Your ${String(n)} fires out there went out when the land went wild. You got some things back 🔥`,
  ok: 'Okay!',
} as const;

/** A mark over a tile: 💛 just started fading, 🍂 further along, 🌱 went wild from me. */
export type LandMark = '💛' | '🍂' | '🌱';

/** From this far into fading (%), a tile shows 🍂 instead of 💛. */
const LEAF_FROM_PERCENT = 50; // TUNE: the mockup's two stages

/**
 * The marks to draw: my fading tiles, and my tiles that went wild lately and
 * are still wild (nobody has claimed them since). `tiles` is the map's view.
 */
export function landMarks(
  tending: LandTending | null,
  tiles: readonly Pick<PublicTile, 'q' | 'r' | 'ownerUserId'>[],
): Map<HexKey, LandMark> {
  const marks = new Map<HexKey, LandMark>();
  if (!tending) return marks;
  for (const t of tending.missing) marks.set(hexKey(t), t.fade >= LEAF_FROM_PERCENT ? '🍂' : '💛');
  const owners = new Map(tiles.map((t) => [hexKey(t), t.ownerUserId]));
  for (const t of tending.wentWild) {
    if (owners.get(hexKey(t)) === null) marks.set(hexKey(t), '🌱');
  }
  return marks;
}

/**
 * How far each fading tile is drawn towards wild (0–1). The map draws at
 * least a little fade as soon as a tile misses me, so the warning shows from
 * day one of it.
 */
export function landFade(tending: LandTending | null): Map<HexKey, number> {
  const MIN = 0.15; // TUNE: a visible first step
  const fade = new Map<HexKey, number>();
  for (const t of tending?.missing ?? []) fade.set(hexKey(t), MIN + ((1 - MIN) * t.fade) / 100);
  return fade;
}

/** The newest night something of mine went wild, or null. */
export function latestWildNight(tending: LandTending | null): string | null {
  let latest: string | null = null;
  for (const t of tending?.wentWild ?? [])
    if (latest === null || t.night > latest) latest = t.night;
  return latest;
}

/**
 * My fires that came down with land that went wild after the night I last
 * saw (#202): how many, and everything that came back, added up.
 */
export function unseenLostFires(
  tending: LandTending | null,
  seenNight: string | null,
): { fires: number; back: Record<string, number> } {
  const back: Record<string, number> = {};
  let fires = 0;
  for (const t of tending?.wentWild ?? []) {
    if (t.lostFire === null || (seenNight !== null && t.night <= seenNight)) continue;
    fires += 1;
    for (const [id, n] of Object.entries(t.lostFire)) back[id] = (back[id] ?? 0) + n;
  }
  return { fires, back };
}

/** Tiles that went wild after the night I last saw on the welcome-back card. */
export function unseenWild(tending: LandTending | null, seenNight: string | null): number {
  return (tending?.wentWild ?? []).filter((t) => seenNight === null || t.night > seenNight).length;
}

/**
 * Visit's colour ripple: each fading tile's share `elapsedMs` into it, the
 * colour coming back outward from home (nearest first) over `durationMs`.
 */
export function rippleFade(
  from: ReadonlyMap<HexKey, number>,
  tiles: readonly Hex[],
  home: Hex | null,
  elapsedMs: number,
  durationMs: number,
): Map<HexKey, number> {
  const at = new Map(tiles.map((t) => [hexKey(t), t]));
  const far = Math.max(1, ...[...from.keys()].map((k) => distanceOf(at.get(k), home)));
  const out = new Map<HexKey, number>();
  // Half the time is the wave travelling out, half each tile's own clearing.
  const each = durationMs / 2;
  for (const [key, share] of from) {
    const start = (distanceOf(at.get(key), home) / far) * (durationMs - each);
    const t = Math.min(1, Math.max(0, (elapsedMs - start) / each));
    if (t < 1) out.set(key, share * (1 - t));
  }
  return out;
}

const distanceOf = (tile: Hex | undefined, home: Hex | null) =>
  tile && home ? hexDistance(tile, home) : 0;
