import { BATTLE_CAMERA } from './battle-config.js';
import type { CameraCue } from './choreography.js';

// The battle camera (owner decision 2026-10-04): frames both fighters, leans
// towards whoever a step is about, pushes in on hits and shakes a little.
// Plain numbers in and out (no Babylon), so it's unit tested; the scene
// writes the result into the stage camera before each frame.

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface CameraShot {
  readonly position: Point3;
  readonly target: Point3;
  readonly fov: number;
  /** Vertical lens shift (NDC units, + moves the picture up). */
  readonly shift: number;
}

/** How far back the camera sits so the fight's width and height fit the screen. */
export function frameDistance(aspect: number, config = BATTLE_CAMERA): number {
  const tan = Math.tan(config.fov / 2);
  const forHeight = config.frameHeight / 2 / tan;
  const forWidth = config.frameWidth / 2 / (tan * Math.max(0.2, aspect));
  return Math.max(forHeight, forWidth);
}

const NO_SHAKE = { x: 0, y: 0 } as const;

/** A shake's offset `age` ms after it started: a quick wobble that dies away. 0 with reduced motion. */
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
  #focus: { x: number; z: number } = { x: 0, z: 0 };
  #push = 0;
  #want = { focusX: 0, focusZ: 0, push: 0 };
  #pushAt = 0;
  #shake = { amount: 0, at: 0 };
  #last: number | null = null;
  /** Reused every frame, so following the fight allocates nothing. */
  readonly #shot = {
    position: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 0, z: 0 },
    fov: 0,
    shift: 0,
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
    const len = home ? Math.hypot(home.x, home.z) || 1 : 1;
    this.#want = {
      focusX: home ? (home.x / len) * shift : 0,
      focusZ: home ? (home.z / len) * shift : 0,
      push: this.#reduced ? 0 : cue.push,
    };
    this.#pushAt = now + cue.pushDelay;
    if (!this.#reduced && cue.shake > 0) {
      this.#shake = { amount: cue.shake, at: now + cue.shakeDelay };
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

  /** The camera at `now` for a screen of `aspect` (width / height). The result is reused next call. */
  shot(now: number, aspect: number): CameraShot {
    const dt = this.#last === null ? 1 : Math.min(0.1, Math.max(0, (now - this.#last) / 1000));
    this.#last = now;
    // Smoothly follow (frame-rate independent exponential easing).
    const k = this.#reduced ? 1 : 1 - Math.exp(-this.#config.follow * dt);
    this.#focus.x += (this.#want.focusX - this.#focus.x) * k;
    this.#focus.z += (this.#want.focusZ - this.#focus.z) * k;
    if (now >= this.#pushAt) this.#push += (this.#want.push - this.#push) * Math.min(1, k * 1.6);

    const { aim, pitch, fov } = this.#config;
    const distance = frameDistance(aspect, this.#config) * (1 - this.#push);
    const tx = aim.x + this.#focus.x;
    const tz = aim.z + this.#focus.z;
    const shake = shakeOffset(this.#shake.amount, now - this.#shake.at, this.#config);
    // Looking along +z, tilted down by `pitch`.
    const back = Math.cos(pitch) * distance;
    const up = Math.sin(pitch) * distance;
    const shot = this.#shot;
    shot.position.x = tx + shake.x;
    shot.position.y = aim.y + up + shake.y;
    shot.position.z = tz - back;
    shot.target.x = tx + shake.x;
    shot.target.y = aim.y + shake.y;
    shot.target.z = tz;
    shot.fov = fov;
    shot.shift = this.#config.lensShift;
    return shot;
  }
}
