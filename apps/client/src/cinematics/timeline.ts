import {
  CINEMATIC_DEFAULT_FOV,
  type Cinematic,
  type CinematicActor,
  type CinematicActorKey,
  type CinematicCameraKey,
  type CinematicMove,
  type CinematicMusic,
  type CinematicShot,
} from '@heartpatch/shared';

// Evaluating the cinematic's timeline (tech spec §6, "Cinematic player"):
// pure functions of time, so the player can seek (a tap jumps to the next
// caption) and the tests can check every rule without a renderer. Times are
// seconds from the start of the whole cinematic unless named `local`
// (seconds into one shot).

export type Vec3 = readonly [number, number, number];

export interface CameraPose {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly fov: number;
}

/** Where an actor is and how it looks at one moment (null from `actorAt`: off screen). */
export interface ActorPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: number;
  readonly yaw: number;
  readonly alpha: number;
  readonly glow: number;
  readonly lit: boolean;
}

export interface Mood {
  readonly drain: number;
  readonly night: number;
  readonly glow: number;
}

export interface TimedCaption {
  /** Index in the whole cinematic, in order. */
  readonly index: number;
  readonly shot: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface Timeline {
  readonly cinematic: Cinematic;
  /** When each shot starts. */
  readonly starts: readonly number[];
  readonly total: number;
  readonly captions: readonly TimedCaption[];
  /** When the title card comes up, if it does. */
  readonly titleAt: number | null;
  /** Soft dissolves through cream: shots that open with one, and those inside shots. */
  readonly dissolves: readonly number[];
}

/** How long a dissolve takes each way, and the title card's fade in, seconds. */
export const TIMELINE = {
  dissolveHalfS: 0.45, // TUNE
  titleFadeS: 1.2, // TUNE
  /** Fade from cream at the very start, and back to it at the very end. */
  edgeFadeS: 0.8, // TUNE
} as const;

export function createTimeline(cinematic: Cinematic): Timeline {
  const starts: number[] = [];
  const captions: TimedCaption[] = [];
  const dissolves: number[] = [];
  let titleAt: number | null = null;
  let t = 0;
  cinematic.shots.forEach((shot, i) => {
    starts.push(t);
    if (shot.transition === 'dissolve' && i > 0) dissolves.push(t);
    for (const d of shot.dissolves) dissolves.push(t + d);
    for (const c of shot.captions) {
      captions.push({
        index: captions.length,
        shot: i,
        start: t + c.at,
        end: t + c.until,
        text: c.text,
      });
    }
    if (shot.titleAt !== undefined && titleAt === null) titleAt = t + shot.titleAt;
    t += shot.duration;
  });
  return { cinematic, starts, total: t, captions, titleAt, dissolves };
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** The shot playing at `t` (clamped to the timeline) and how far into it. */
export function shotAt(
  timeline: Timeline,
  t: number,
): { index: number; shot: CinematicShot; local: number } {
  const { shots } = timeline.cinematic;
  const time = Math.min(Math.max(t, 0), timeline.total);
  let index = 0;
  for (let i = 0; i < shots.length; i += 1) {
    if ((timeline.starts[i] ?? 0) <= time) index = i;
  }
  // Exactly at a boundary, the next shot has started (except at the very end).
  const shot = shots[index];
  if (!shot) throw new Error('a cinematic needs at least one shot');
  return { index, shot, local: Math.min(time - (timeline.starts[index] ?? 0), shot.duration) };
}

// ── Interpolation ───────────────────────────────────────────────────────

/**
 * Monotone cubic interpolation through `(t, v)` keys (Fritsch–Butland):
 * smooth through every key, easing in at the first and out at the last, and
 * never overshooting, so a held pose stays still and a squishy's arc peaks
 * exactly on its key. Keys must be in time order with distinct times.
 */
export function smoothPath(keys: readonly { t: number; v: number }[], time: number): number {
  return smoothBy(keys, time, keyT, keyV);
}

const keyT = (k: { t: number }): number => k.t;
const keyV = (k: { v: number }): number => k.v;

/**
 * `smoothPath` over any keys, reading each key's time and value through
 * `at` and `value`, so a frame's evaluation builds no `{ t, v }` arrays.
 */
function smoothBy<K>(
  keys: readonly K[],
  time: number,
  at: (key: K) => number,
  value: (key: K) => number,
): number {
  const first = keys[0];
  const last = keys.at(-1);
  if (first === undefined || last === undefined) return 0;
  if (time <= at(first)) return value(first);
  if (time >= at(last)) return value(last);
  let i = 0;
  while (i < keys.length - 2) {
    const next = keys[i + 1];
    if (next === undefined || at(next) > time) break;
    i += 1;
  }
  const a = keys[i];
  const b = keys[i + 1];
  if (a === undefined || b === undefined) return value(last);
  const slope = (k: number): number => {
    const p = keys[k - 1];
    const q = keys[k];
    const r = keys[k + 1];
    if (p === undefined || q === undefined || r === undefined) return 0; // ends ease in and out
    const d0 = (value(q) - value(p)) / (at(q) - at(p));
    const d1 = (value(r) - value(q)) / (at(r) - at(q));
    if (d0 * d1 <= 0) return 0; // a turn or a hold: stop there
    return 2 / (1 / d0 + 1 / d1);
  };
  const av = value(a);
  const bv = value(b);
  const h = at(b) - at(a);
  const s = (time - at(a)) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  return (
    (2 * s3 - 3 * s2 + 1) * av +
    (s3 - 2 * s2 + s) * h * slope(i) +
    (-2 * s3 + 3 * s2) * bv +
    (s3 - s2) * h * slope(i + 1)
  );
}

/**
 * Splits keys into runs that ease into one another: a new run starts at a
 * key marked `cut`, or at a key with the same time as the one before.
 */
export function segments<K extends { at: number; cut?: boolean }>(keys: readonly K[]): K[][] {
  const runs: K[][] = [];
  let run: K[] = [];
  for (const key of keys) {
    const before = run.at(-1);
    if (before && (key.cut === true || key.at <= before.at)) {
      runs.push(run);
      run = [];
    }
    run.push(key);
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/**
 * Runs per key list. The key lists are the cinematic's own data, which never
 * changes once loaded, so each is split once rather than on every frame.
 */
const runsCache = new WeakMap<readonly object[], readonly object[][]>();

function runsOf<K extends { at: number; cut?: boolean }>(keys: readonly K[]): readonly K[][] {
  // A WeakMap can't type its value by its key, so the runs come back cast.
  let runs = runsCache.get(keys) as readonly K[][] | undefined;
  if (!runs) {
    runs = segments(keys);
    runsCache.set(keys, runs);
  }
  return runs;
}

/** The run of keys in charge at `local`: the last one that has started. */
function runAt<K extends { at: number; cut?: boolean }>(
  keys: readonly K[],
  local: number,
): readonly K[] {
  const runs = runsOf(keys);
  let current = runs[0] ?? [];
  for (const run of runs) if ((run[0]?.at ?? 0) <= local) current = run;
  return current;
}

const along = <K extends { at: number }>(
  run: readonly K[],
  local: number,
  value: (key: K) => number,
): number => smoothBy(run, local, keyAt, value);

const keyAt = (k: { at: number }): number => k.at;

/** An actor's path without its flicker keys (reduced motion), worked out once per actor. */
const steadyCache = new WeakMap<CinematicActor, readonly CinematicActorKey[]>();

function steadyPath(actor: CinematicActor): readonly CinematicActorKey[] {
  let keys = steadyCache.get(actor);
  if (!keys) {
    keys = actor.path.filter((k) => k.flash !== true);
    steadyCache.set(actor, keys);
  }
  return keys;
}

// What each pose field reads from a key, made once (not per frame).
const CAMERA_PICK = {
  px: (k: CinematicCameraKey) => k.position[0],
  py: (k: CinematicCameraKey) => k.position[1],
  pz: (k: CinematicCameraKey) => k.position[2],
  tx: (k: CinematicCameraKey) => k.target[0],
  ty: (k: CinematicCameraKey) => k.target[1],
  tz: (k: CinematicCameraKey) => k.target[2],
  fov: (k: CinematicCameraKey) => k.fov ?? CINEMATIC_DEFAULT_FOV,
} as const;

const ACTOR_PICK = {
  x: (k: CinematicActorKey) => k.x,
  y: (k: CinematicActorKey) => k.y ?? 0,
  z: (k: CinematicActorKey) => k.z,
  scale: (k: CinematicActorKey) => k.scale ?? 1,
  yaw: (k: CinematicActorKey) => k.yaw ?? 0,
  alpha: (k: CinematicActorKey) => k.alpha ?? 1,
  glow: (k: CinematicActorKey) => k.glow ?? 1,
} as const;

const MOOD_PICK = {
  drain: (k: CinematicShot['mood'][number]) => k.drain,
  night: (k: CinematicShot['mood'][number]) => k.night,
  glow: (k: CinematicShot['mood'][number]) => k.glow,
} as const;

/**
 * The camera at `local` seconds into `shot`. With `reducedMotion` the camera
 * doesn't travel: each run (between cuts) holds its settled, final framing.
 */
export function cameraAt(shot: CinematicShot, local: number, reducedMotion: boolean): CameraPose {
  const run = runAt(shot.camera, local);
  const p = CAMERA_PICK;
  if (reducedMotion) {
    const held = run.at(-1);
    if (!held) throw new Error(`shot ${shot.id} has no camera`);
    return { position: held.position, target: held.target, fov: p.fov(held) };
  }
  return {
    position: [along(run, local, p.px), along(run, local, p.py), along(run, local, p.pz)],
    target: [along(run, local, p.tx), along(run, local, p.ty), along(run, local, p.tz)],
    fov: along(run, local, p.fov),
  };
}

export function moodAt(shot: CinematicShot, local: number): Mood {
  return {
    drain: clamp01(along(shot.mood, local, MOOD_PICK.drain)),
    night: clamp01(along(shot.mood, local, MOOD_PICK.night)),
    glow: clamp01(along(shot.mood, local, MOOD_PICK.glow)),
  };
}

/**
 * An actor's pose at `local`, or null while it's off screen (before its
 * first key or after its last; a one-key actor stays to the end of the
 * shot). With `reducedMotion`, flicker keys (`flash`) are skipped.
 */
export function actorAt(
  actor: CinematicActor,
  local: number,
  reducedMotion: boolean,
  shotDuration: number,
): ActorPose | null {
  const keys = reducedMotion ? steadyPath(actor) : actor.path;
  const first = keys[0];
  const last = keys.at(-1);
  if (!first || !last) return null;
  const until = keys.length === 1 ? shotDuration : last.at;
  if (local < first.at || local > until) return null;
  const run = runAt(keys, local);
  const p = ACTOR_PICK;
  let lit = true;
  for (const k of keys) if (k.at <= local && k.lit !== undefined) lit = k.lit;
  return {
    x: along(run, local, p.x),
    y: along(run, local, p.y),
    z: along(run, local, p.z),
    scale: Math.max(0, along(run, local, p.scale)),
    yaw: along(run, local, p.yaw),
    alpha: clamp01(along(run, local, p.alpha)),
    glow: clamp01(along(run, local, p.glow)),
    lit,
  };
}

// ── Captions, taps and moments ──────────────────────────────────────────

/** The caption on screen at `t`, if any. */
export function captionAt(timeline: Timeline, t: number): TimedCaption | null {
  return timeline.captions.find((c) => c.start <= t && t < c.end) ?? null;
}

/**
 * Where a tap jumps to (style guide §6, "tap to advance"): the next
 * caption, else the title card, else the end.
 */
export function nextStop(timeline: Timeline, t: number): number {
  const next = timeline.captions.find((c) => c.start > t + 1e-6);
  if (next) return next.start;
  if (timeline.titleAt !== null && timeline.titleAt > t + 1e-6) return timeline.titleAt;
  return timeline.total;
}

export interface TimedCue {
  readonly at: number;
  readonly cue: string;
}

export interface TimedMove {
  readonly at: number;
  readonly shot: number;
  readonly actor: string;
  readonly move: CinematicMove;
}

/** Cues whose time falls in `(from, to]`, in order. A seek passes `from === to`: none. */
export function cuesBetween(timeline: Timeline, from: number, to: number): TimedCue[] {
  const out: TimedCue[] = [];
  timeline.cinematic.shots.forEach((shot, i) => {
    const start = timeline.starts[i] ?? 0;
    for (const c of shot.cues) {
      const at = start + c.at;
      if (at > from && at <= to) out.push({ at, cue: c.cue });
    }
  });
  return out;
}

/** Squish moves whose time falls in `(from, to]`, in order. */
export function movesBetween(timeline: Timeline, from: number, to: number): TimedMove[] {
  const out: TimedMove[] = [];
  timeline.cinematic.shots.forEach((shot, i) => {
    const start = timeline.starts[i] ?? 0;
    for (const actor of shot.actors) {
      for (const m of actor.moves) {
        const at = start + m.at;
        if (at > from && at <= to) out.push({ at, shot: i, actor: actor.id, move: m.move });
      }
    }
  });
  return out.sort((a, b) => a.at - b.at);
}

/** The music under `t`. */
export function musicAt(timeline: Timeline, t: number): CinematicMusic {
  return shotAt(timeline, t).shot.music;
}

/**
 * How opaque the cream veil is at `t` (0–1): a dissolve between shots, and a
 * soft fade in at the start and out at the end. Fades are slow and soft, never
 * a flash, so they stay for reduced motion too.
 */
export function veilAt(timeline: Timeline, t: number): number {
  const half = TIMELINE.dissolveHalfS;
  let veil = 0;
  for (const d of timeline.dissolves) veil = Math.max(veil, 1 - Math.abs(t - d) / half);
  veil = Math.max(veil, 1 - t / TIMELINE.edgeFadeS, 1 - (timeline.total - t) / TIMELINE.edgeFadeS);
  return clamp01(veil);
}

/** How far the title card has faded in (0 before it comes up). */
export function titleAt(timeline: Timeline, t: number): number {
  if (timeline.titleAt === null || t < timeline.titleAt) return 0;
  return clamp01((t - timeline.titleAt) / TIMELINE.titleFadeS);
}
