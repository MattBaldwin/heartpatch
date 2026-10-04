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
  const first = keys[0];
  const last = keys.at(-1);
  if (!first || !last) return 0;
  if (time <= first.t) return first.v;
  if (time >= last.t) return last.v;
  let i = 0;
  while (i < keys.length - 2 && (keys[i + 1]?.t ?? Infinity) <= time) i += 1;
  const a = keys[i];
  const b = keys[i + 1];
  if (!a || !b) return last.v;
  const slope = (k: number): number => {
    const p = keys[k - 1];
    const q = keys[k];
    const r = keys[k + 1];
    if (!p || !q || !r) return 0; // ends ease in and out
    const d0 = (q.v - p.v) / (q.t - p.t);
    const d1 = (r.v - q.v) / (r.t - q.t);
    if (d0 * d1 <= 0) return 0; // a turn or a hold: stop there
    return 2 / (1 / d0 + 1 / d1);
  };
  const h = b.t - a.t;
  const s = (time - a.t) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  return (
    (2 * s3 - 3 * s2 + 1) * a.v +
    (s3 - 2 * s2 + s) * h * slope(i) +
    (-2 * s3 + 3 * s2) * b.v +
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

/** The run of keys in charge at `local`: the last one that has started. */
function runAt<K extends { at: number; cut?: boolean }>(keys: readonly K[], local: number): K[] {
  const runs = segments(keys);
  let current = runs[0] ?? [];
  for (const run of runs) if ((run[0]?.at ?? 0) <= local) current = run;
  return current;
}

const along = <K extends { at: number }>(
  run: readonly K[],
  local: number,
  value: (key: K) => number,
): number =>
  smoothPath(
    run.map((k) => ({ t: k.at, v: value(k) })),
    local,
  );

/**
 * The camera at `local` seconds into `shot`. With `reducedMotion` the camera
 * doesn't travel: each run (between cuts) holds its settled, final framing.
 */
export function cameraAt(shot: CinematicShot, local: number, reducedMotion: boolean): CameraPose {
  const run = runAt(shot.camera, local);
  const fovOf = (k: CinematicCameraKey) => k.fov ?? CINEMATIC_DEFAULT_FOV;
  if (reducedMotion) {
    const held = run.at(-1);
    if (!held) throw new Error(`shot ${shot.id} has no camera`);
    return { position: held.position, target: held.target, fov: fovOf(held) };
  }
  const v = (pick: (k: CinematicCameraKey) => number) => along(run, local, pick);
  return {
    position: [v((k) => k.position[0]), v((k) => k.position[1]), v((k) => k.position[2])],
    target: [v((k) => k.target[0]), v((k) => k.target[1]), v((k) => k.target[2])],
    fov: v(fovOf),
  };
}

export function moodAt(shot: CinematicShot, local: number): Mood {
  return {
    drain: clamp01(along(shot.mood, local, (k) => k.drain)),
    night: clamp01(along(shot.mood, local, (k) => k.night)),
    glow: clamp01(along(shot.mood, local, (k) => k.glow)),
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
  const keys = reducedMotion ? actor.path.filter((k) => k.flash !== true) : actor.path;
  const first = keys[0];
  const last = keys.at(-1);
  if (!first || !last) return null;
  const until = keys.length === 1 ? shotDuration : last.at;
  if (local < first.at || local > until) return null;
  const run = runAt(keys, local);
  const v = (pick: (k: CinematicActorKey) => number) => along(run, local, pick);
  let lit = true;
  for (const k of keys) if (k.at <= local && k.lit !== undefined) lit = k.lit;
  return {
    x: v((k) => k.x),
    y: v((k) => k.y ?? 0),
    z: v((k) => k.z),
    scale: Math.max(
      0,
      v((k) => k.scale ?? 1),
    ),
    yaw: v((k) => k.yaw ?? 0),
    alpha: clamp01(v((k) => k.alpha ?? 1)),
    glow: clamp01(v((k) => k.glow ?? 1)),
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
