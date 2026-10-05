import { BATTLE_CAMERA } from './battle-config.js';
import type { CameraCue } from './choreography.js';

// Lantern Hour's camera (owner decision 2026-10-05): a fixed rig (pitch,
// swing, fov) that fits the fight into the safe region between the HUD's
// pills and its bottom sheet, moves the picture up with a vertical lens shift
// so the horizon stays level, leans towards whoever a step is about, and adds
// Saturday Morning Smackdown's beats on impact (a push-in, a light shake, a
// dutch roll on a super hit). Plain numbers in and out (no Babylon), so it's
// unit tested; the scene writes the result into the stage camera before each
// frame.

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Fractions of the screen height, from the top: where the fight may be drawn. */
export interface SafeRegion {
  readonly top: number;
  readonly bottom: number;
}

/** Something that must stay on screen: a ground point with a radius and a height above it. */
export interface FitPoint {
  x: number;
  z: number;
  r: number;
  h: number;
}

export interface CameraShot {
  readonly position: Point3;
  readonly target: Point3;
  /** The camera's up vector (rolled on impact). */
  readonly up: Point3;
  readonly fov: number;
  /** Vertical lens shift (NDC units, + moves the picture up). */
  readonly shift: number;
  readonly distance: number;
}

/**
 * How far back the camera sits so the fight's box and every fit point fit
 * the safe region: sideways within the screen (with a margin), upwards within
 * the headroom under the pills, each judged at its own depth along the view.
 */
export function frameDistance(
  aspect: number,
  safe: SafeRegion,
  fit: readonly FitPoint[],
  config = BATTLE_CAMERA,
): { distance: number; shift: number } {
  const tan = Math.tan(config.fov / 2);
  const feetY = Math.min(config.feetY, safe.bottom - 0.08);
  const headroom = Math.max(0.15, (feetY - safe.top - 0.03) * 2);
  const yc = Math.cos(config.yaw);
  const ys = Math.sin(config.yaw);
  const cp = Math.cos(config.pitch);
  const wide = tan * Math.max(0.3, aspect);
  let distance = Math.max(config.fitHeight / (tan * headroom), config.fitHalfWidth / (wide * 0.95));
  for (const f of fit) {
    const dx = f.x - config.aim.x;
    const dz = f.z - config.aim.z;
    // Along the view (ground-projected) and across it.
    const along = (dx * ys + dz * yc) * cp;
    const across = Math.abs(dx * yc - dz * ys) + f.r;
    distance = Math.max(distance, across / (wide * 0.94) + along);
    distance = Math.max(distance, f.h / (tan * headroom) + along);
  }
  return { distance, shift: 1 - 2 * feetY };
}

const NO_SHAKE = { x: 0, y: 0 } as const;

/** A shake's offset `age` ms after it started: a quick wobble that dies away. */
export function shakeOffset(
  amount: number,
  age: number,
  config = BATTLE_CAMERA,
): { x: number; y: number } {
  if (amount <= 0 || age < 0) return NO_SHAKE;
  const t = age / 1000;
  const fade = Math.exp(-config.shakeDecay * t);
  if (fade < 0.01) return NO_SHAKE;
  const w = Math.PI * 2 * config.shakeHz * t;
  return { x: amount * fade * Math.sin(w), y: amount * fade * 0.6 * Math.sin(w * 1.37 + 1.1) };
}

export class CameraDirector {
  readonly #config: typeof BATTLE_CAMERA;
  readonly #reduced: boolean;
  /** Where each fighter stands (ground points), to lean towards. */
  readonly #homes: Readonly<Record<'a' | 'b', { x: number; z: number }>>;
  #focus = { x: 0, z: 0 };
  #push = 0;
  #want = { focusX: 0, focusZ: 0, push: 0 };
  #pushAt = 0;
  #shake = { amount: 0, roll: 0, at: 0 };
  #last: number | null = null;
  /** Reused every frame, so following the fight allocates nothing. */
  readonly #shot = {
    position: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    fov: 0,
    shift: 0,
    distance: 0,
  };

  constructor(
    homes: Readonly<Record<'a' | 'b', { x: number; z: number }>>,
    reduced: boolean,
    config = BATTLE_CAMERA,
  ) {
    this.#homes = homes;
    this.#reduced = reduced;
    this.#config = config;
  }

  /** A new step's camera beat, starting at `now` (ms). */
  cue(cue: CameraCue, now: number): void {
    const shift = this.#config.focusShift * (this.#reduced ? 0.4 : 1);
    const home = cue.focus ? this.#homes[cue.focus] : null;
    this.#want = {
      focusX: home ? (home.x - this.#config.aim.x) * shift : 0,
      focusZ: home ? (home.z - this.#config.aim.z) * shift : 0,
      push: this.#reduced ? 0 : cue.push,
    };
    this.#pushAt = now + cue.pushDelay;
    if (!this.#reduced && cue.shake > 0) {
      this.#shake = { amount: cue.shake, roll: cue.roll, at: now + cue.shakeDelay };
    }
  }

  /** Back to framing both fighters (the turn is over). */
  rest(): void {
    this.#want = { focusX: 0, focusZ: 0, push: 0 };
  }

  /** True while the camera is still travelling or shaking (keep drawing). */
  moving(now: number): boolean {
    const shaking = shakeOffset(this.#shake.amount, now - this.#shake.at, this.#config);
    return (
      Math.abs(this.#focus.x - this.#want.focusX) > 0.002 ||
      Math.abs(this.#focus.z - this.#want.focusZ) > 0.002 ||
      Math.abs(this.#push - (now >= this.#pushAt ? this.#want.push : this.#push)) > 0.001 ||
      shaking.x !== 0
    );
  }

  /**
   * The camera at `now` for a screen of `aspect` (width / height), keeping
   * `fit` inside `safe`. The result is reused next call.
   */
  shot(now: number, aspect: number, safe: SafeRegion, fit: readonly FitPoint[]): CameraShot {
    const dt = this.#last === null ? 1 : Math.min(0.1, Math.max(0, (now - this.#last) / 1000));
    this.#last = now;
    // Smoothly follow (frame-rate independent exponential easing).
    const k = this.#reduced ? 1 : 1 - Math.exp(-this.#config.follow * dt);
    this.#focus.x += (this.#want.focusX - this.#focus.x) * k;
    this.#focus.z += (this.#want.focusZ - this.#focus.z) * k;
    if (now >= this.#pushAt) {
      this.#push += (this.#want.push - this.#push) * Math.min(1, k * 1.6);
      // A beat relaxes on its own: the push-in eases back as the hit settles.
      this.#want.push *= Math.exp(-this.#config.beatDecay * dt);
    }

    const { aim, pitch, yaw, fov } = this.#config;
    const frame = frameDistance(aspect, safe, fit, this.#config);
    const distance = frame.distance * (1 - this.#push);
    const tx = aim.x + this.#focus.x;
    const tz = aim.z + this.#focus.z;
    const age = now - this.#shake.at;
    const shake = shakeOffset(this.#shake.amount, age, this.#config);
    const fade =
      this.#shake.amount > 0 && age >= 0 ? Math.exp(-this.#config.shakeDecay * (age / 1000)) : 0;
    const roll = this.#shake.roll * fade;
    // Looking along +z, swung by yaw and tilted down by pitch.
    const back = Math.cos(pitch) * distance;
    const up = Math.sin(pitch) * distance;
    const shot = this.#shot;
    shot.position.x = tx - Math.sin(yaw) * back + shake.x;
    shot.position.y = aim.y + up + shake.y;
    shot.position.z = tz - Math.cos(yaw) * back;
    shot.target.x = tx + shake.x;
    shot.target.y = aim.y + shake.y;
    shot.target.z = tz;
    shot.up.x = Math.sin(roll);
    shot.up.y = Math.cos(roll);
    shot.up.z = 0;
    shot.fov = fov;
    shot.shift = frame.shift;
    shot.distance = distance;
    return shot;
  }
}
