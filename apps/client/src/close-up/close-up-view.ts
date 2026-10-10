import {
  GAME_DATA,
  NicknameSchema,
  type CareListResponse,
  type CareSquishy,
} from '@heartpatch/shared';
import { careSheet, speciesById, type CareSheetModel } from '../care/care-view.js';
import {
  IDLE,
  IDLE_BY_FEELING,
  REACTIONS,
  type ClosePose,
  type IdleMove,
  type Reaction,
} from './close-up-config.js';
import type { Gesture } from './gestures.js';

/*
 * The close-up view's model (#20, design doc §20): which care action each
 * gesture asks for, whether to send it, how the squishy reacts, what the
 * info card says, and the camera and idle maths. Pure, so it's unit-tested
 * without the DOM or a GPU. Mood, hearts, level and XP come from the care
 * sheet's model (#19), so both views always agree.
 */

/** A gesture, or dragging a treat onto the squishy. */
export type CloseUpTouch = Exclude<Gesture, 'back'> | 'treat';

/** The care action each touch asks for (design doc §7: boop and tickle are play). */
export const TOUCH_CARE: Readonly<Record<CloseUpTouch, string>> = {
  boop: 'play',
  tickle: 'play',
  stroke: 'pet',
  treat: 'feed',
};

/** What the squishy does for each touch, whatever the server says. */
const TOUCH_REACTION: Readonly<Record<CloseUpTouch, keyof typeof REACTIONS>> = {
  boop: 'boop',
  stroke: 'wiggle',
  tickle: 'giggle',
  treat: 'nom',
};

// Player-facing text (style guide §2, §6, §9).
export const CLOSE_UP_TEXT = {
  back: 'Back',
  about: 'About',
  hint: 'Boop, stroke or pinch to tickle! Drag a 🍪 over to share.',
  level: (n: number) => `Level ${String(n)}`,
  element: 'Element',
  feeling: 'Feeling',
  moves: 'Moves',
  rename: 'Rename',
  save: 'Save',
  cancel: 'Cancel',
  clear: 'Use species name',
  nameLabel: 'New name',
  renamed: (name: string) => `Hello, ${name}!`,
  resting: 'They loved that! Give them a sec.',
  noTreats: 'No Treats left. Gather some on the map!',
  mysterySquishy: 'Mystery squishy',
  gone: "They've wandered off for now. Let's go find them!",
} as const;

/** Why a touch didn't go to the server (it still gets its reaction). */
export type CareHold = 'resting' | 'noTreats' | 'busy';

export interface CareDecision {
  readonly action: string;
  /** Null: send it. Otherwise why not. */
  readonly hold: CareHold | null;
}

/**
 * Whether a touch sends its care action. The server has the last word (its
 * debounce, diminishing returns and coins, CLAUDE.md rule 1); this only
 * avoids sending what it would refuse: an action still in its debounce
 * (`nextCareAt`, on the server's clock), one already on its way, or a treat
 * with none in the bag.
 */
export function careDecision(
  touch: CloseUpTouch,
  squishy: Pick<CareSquishy, 'nextCareAt'>,
  reply: Pick<CareListResponse, 'items'>,
  serverNow: number,
  inFlight: ReadonlySet<string>,
): CareDecision {
  const action = TOUCH_CARE[touch];
  if (inFlight.has(action)) return { action, hold: 'busy' };
  const ready = squishy.nextCareAt[action];
  if (ready !== undefined && Date.parse(ready) > serverNow) return { action, hold: 'resting' };
  const cost = GAME_DATA.careActions.find((a) => a.id === action)?.cost ?? {};
  const short = Object.entries(cost).some(([id, n]) => (reply.items[id] ?? 0) < n);
  return { action, hold: short ? 'noTreats' : null };
}

/** The squishy's reaction to a touch: a softer one when the touch didn't count. */
export function reactionFor(touch: CloseUpTouch, hold: CareHold | null): Reaction {
  if (hold === 'noTreats') return REACTIONS.sniff;
  const reaction = REACTIONS[TOUCH_REACTION[touch]];
  return hold === null ? reaction : { ...reaction, strength: reaction.strength * 0.6 };
}

export interface InfoCard extends CareSheetModel {
  readonly levelNumber: number;
  readonly element: string;
  readonly feeling: string;
  readonly moves: readonly string[];
  /** The nickname, or null when it goes by its species name. */
  readonly nickname: string | null;
  readonly speciesName: string;
}

/** "tickle-tackle" → "Tickle Tackle", for a move this client has no row for. */
export function tidyId(id: string): string {
  return id
    .split('-')
    .filter((w) => w !== '')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** The info card: everything on the care sheet, plus element, feeling and moves. */
export function infoCard(
  squishy: CareSquishy,
  reply: Pick<CareListResponse, 'speciesDefs' | 'items' | 'now'>,
  now?: number,
): InfoCard {
  const sheet = careSheet(squishy, reply, now);
  const species = speciesById(reply).get(squishy.speciesId);
  const moveNames = new Map(GAME_DATA.moves.map((m) => [m.id, m.name]));
  return {
    ...sheet,
    levelNumber: squishy.level,
    element: GAME_DATA.elements.find((e) => e.id === squishy.element)?.name ?? squishy.element,
    feeling: GAME_DATA.feelings.find((f) => f.id === squishy.feeling)?.name ?? squishy.feeling,
    moves: (species?.moves ?? []).map((id) => moveNames.get(id) ?? tidyId(id)),
    nickname: squishy.nickname,
    speciesName: species?.name ?? CLOSE_UP_TEXT.mysterySquishy,
  };
}

/** A typed name, checked the way the server checks it (the server also filters it). */
export function checkNickname(
  text: string,
): { ok: true; name: string } | { ok: false; why: string } {
  const parsed = NicknameSchema.safeParse(text);
  if (parsed.success) return { ok: true, name: parsed.data };
  return { ok: false, why: parsed.error.issues[0]?.message ?? 'Try another name!' };
}

// ── Camera ────────────────────────────────────────────────────────────────

export const easeOutCubic = (t: number): number => 1 - (1 - clamp01(t)) ** 3;
export const easeInOutSine = (t: number): number => (1 - Math.cos(Math.PI * clamp01(t))) / 2;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;

/** A pose `t` (0–1, already eased) of the way from `a` to `b`. */
export function poseBetween(a: ClosePose, b: ClosePose, t: number): ClosePose {
  return {
    distance: mix(a.distance, b.distance, t),
    pitch: mix(a.pitch, b.pitch, t),
    yaw: mix(a.yaw, b.yaw, t),
    lookAt: mix(a.lookAt, b.lookAt, t),
  };
}

export interface CameraPlacement {
  readonly position: { x: number; y: number; z: number };
  readonly target: { x: number; y: number; z: number };
}

/**
 * Where the camera sits for a pose around a squishy standing at the origin
 * and facing −z (squishy-field's convention), `height` tall. `drop` moves
 * the whole camera down (world units), which raises the squishy on screen.
 */
export function cameraFor(pose: ClosePose, height: number, drop = 0): CameraPlacement {
  const target = { x: 0, y: height * pose.lookAt - drop, z: 0 };
  const flat = Math.cos(pose.pitch) * pose.distance;
  return {
    target,
    position: {
      x: Math.sin(pose.yaw) * flat,
      y: target.y + Math.sin(pose.pitch) * pose.distance,
      z: -Math.cos(pose.yaw) * flat,
    },
  };
}

type V3 = { x: number; y: number; z: number };
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const unit = (a: V3): V3 => {
  const n = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / n, y: a.y / n, z: a.z / n };
};

/** A view of the canvas: CSS size and Babylon's vertical field of view. */
export interface ScreenView {
  readonly width: number;
  readonly height: number;
  readonly fov: number;
}

/**
 * A world point on screen, in CSS pixels, for a camera at `camera` (Babylon
 * is left-handed: x right, y up, z into the screen). Null behind the camera.
 */
export function projectPoint(camera: CameraPlacement, view: ScreenView, p: V3) {
  const forward = unit(sub(camera.target, camera.position));
  const right = unit(cross({ x: 0, y: 1, z: 0 }, forward));
  const up = cross(forward, right);
  const v = sub(p, camera.position);
  const depth = dot(v, forward);
  if (depth <= 1e-6) return null;
  const half = Math.tan(view.fov / 2);
  const aspect = view.width / Math.max(1, view.height);
  const nx = dot(v, right) / (depth * half * aspect);
  const ny = dot(v, up) / (depth * half);
  return { x: ((nx + 1) / 2) * view.width, y: ((1 - ny) / 2) * view.height };
}

/**
 * The squishy on screen as an ellipse (for gestures), from its world size:
 * standing at the origin, `height` tall and `width` wide.
 */
export function screenEllipse(
  camera: CameraPlacement,
  view: ScreenView,
  size: { width: number; height: number },
): { x: number; y: number; rx: number; ry: number } | null {
  const forward = unit(sub(camera.target, camera.position));
  const right = unit(cross({ x: 0, y: 1, z: 0 }, forward));
  const up = cross(forward, right);
  const centre = { x: 0, y: size.height / 2, z: 0 };
  const along = (dir: V3, d: number) => ({
    x: centre.x + dir.x * d,
    y: centre.y + dir.y * d,
    z: centre.z + dir.z * d,
  });
  const c = projectPoint(camera, view, centre);
  const r = projectPoint(camera, view, along(right, size.width / 2));
  const u = projectPoint(camera, view, along(up, size.height / 2));
  if (!c || !r || !u) return null;
  return {
    x: c.x,
    y: c.y,
    rx: Math.hypot(r.x - c.x, r.y - c.y),
    ry: Math.hypot(u.x - c.x, u.y - c.y),
  };
}

/** Moved down below the account chip, the squishy keeps at least this gap above the card. */
const CARD_GAP_PX = 12; // TUNE

/** How much of the free space the squishy's height fills, face to face. */
export const FILL = 0.55; // TUNE

/**
 * Face-to-face framing for the space left above the bottom card: far enough
 * back that the squishy fits (never closer than `face`), and the camera
 * dropped so the squishy sits in the middle of the free space, not behind
 * the card. `freeBottom` is the card's top, CSS pixels from the view's top.
 * `freeTop` is what's covered at the top (the account chip, #340): the
 * squishy keeps its size and moves down into the space below it, so a tall
 * hat stays clear of the chip without the squishy shrinking (it must stay
 * big enough to stroke).
 */
export function frameFor(
  face: ClosePose,
  height: number,
  view: ScreenView,
  freeBottom: number,
  freeTop = 0,
): { pose: ClosePose; drop: number } {
  const free = Math.max(view.height * 0.3, Math.min(view.height, freeBottom));
  const half = Math.tan(view.fov / 2);
  // Screen height of the squishy is height / (2 · d · tan(fov/2)) of the view.
  const fit = (height * view.height) / (FILL * free * 2 * half);
  const distance = Math.max(face.distance, fit);
  // Its middle goes to the middle of the free space below what's covered, as
  // far down as it fits with a gap above the card (all the way up: as before).
  const size = (height * view.height) / (distance * 2 * half);
  const top = Math.min(Math.max(0, freeTop), Math.max(0, free - size - 2 * CARD_GAP_PX));
  const shiftPx = view.height / 2 - (top + free) / 2;
  const drop = (shiftPx / (view.height / 2)) * distance * half;
  return { pose: { ...face, distance }, drop };
}

// ── Idle personality ──────────────────────────────────────────────────────

export function idleMoveFor(feeling: string): IdleMove {
  const byFeeling: Readonly<Record<string, IdleMove | undefined>> = IDLE_BY_FEELING;
  return byFeeling[feeling] ?? IDLE_BY_FEELING.joy;
}

/** The squishy's pose offsets `t` (0–1) of the way through an idle move. */
export interface IdlePose {
  /** Extra turn, radians. */
  readonly yaw: number;
  /** Scale multiplier. */
  readonly scale: number;
  /** Up (+) or down (−), as a fraction of height. */
  readonly lift: number;
}

export const REST_POSE: IdlePose = { yaw: 0, scale: 1, lift: 0 };

export function idlePose(move: IdleMove, t: number): IdlePose {
  const u = clamp01(t);
  const bump = Math.sin(Math.PI * u); // 0 → 1 → 0
  switch (move.motion) {
    case 'spin':
      return { ...REST_POSE, yaw: Math.PI * 2 * easeInOutSine(u) };
    case 'puff':
      return { ...REST_POSE, scale: 1 + IDLE.puffScale * bump };
    case 'nod':
      // Sinks slowly, then pops back up.
      return { ...REST_POSE, lift: -IDLE.nodSink * Math.sin(Math.PI * Math.min(1, u * 1.25)) };
    case 'snuggle':
      return { ...REST_POSE, yaw: 0.18 * Math.sin(Math.PI * 2 * u) * bump };
    case 'hop':
      return { ...REST_POSE, lift: IDLE.hopHeight * Math.abs(Math.sin(Math.PI * 2 * u)) };
    case 'boo':
      return { ...REST_POSE, scale: 1 + 0.08 * bump, lift: 0.08 * bump };
  }
}

/** Milliseconds until the next idle move, `roll` in [0, 1). */
export function nextIdleIn(roll: number): number {
  return IDLE.everyMs + (roll * 2 - 1) * IDLE.jitterMs;
}
