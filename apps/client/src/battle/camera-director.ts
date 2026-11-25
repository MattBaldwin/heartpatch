import { ARENA_STAGE } from './arena-config.js';
import { BATTLE_CAMERA, BOSS_CARDS, FIGHTER, type BattleCameraConfig } from './battle-config.js';
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
  /**
   * The lowest row of the screen where the stage shows (#652): `bottom` (the
   * default) when the opaque sheet spans the screen, 1 when it's a card with
   * the screen's bottom corners showing beside it.
   */
  readonly floor?: number;
  /**
   * A boss fight (#868): the lowest row the stage shows while the team cards
   * are faded (the sheet's top), where the team's eyes may go then.
   */
  readonly open?: number;
}

/** Something that must stay on screen: a ground point with a radius and a height above it. */
export interface FitPoint {
  x: number;
  z: number;
  r: number;
  h: number;
}

/**
 * The boss's face in a boss fight (#868): the ground point under it and the
 * heights of its lowest and highest eye or mouth edge, as drawn this frame
 * (lift, squash and lean included).
 */
export interface FacePoint {
  x: number;
  z: number;
  low: number;
  high: number;
  /**
   * How squarely it looks at the camera (1 straight on, 0 side-on, below 0
   * away); left out, it faces the camera.
   */
  facing?: number;
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
 * The scale a squishy is drawn at in battle, from its height at scale 1
 * (#652): the close-up scale, less for a tall one (`FIGHTER.tall`), so a big
 * squishy still looks big but never pushes the camera back.
 */
export function battleScale(
  height: number,
  config: {
    readonly scale: number;
    readonly tall: { readonly knee: number; readonly keep: number; readonly maxHeight: number };
  } = FIGHTER,
): number {
  const tall = height * config.scale;
  const { knee, keep, maxHeight } = config.tall;
  if (!(tall > knee)) return config.scale;
  const drawn = Math.min(maxHeight, knee + (tall - knee) * keep);
  return (config.scale * drawn) / tall;
}

/**
 * How far back the camera sits so the fight's box and every fit point fit
 * the safe region: sideways within the screen (with a margin), upwards within
 * the headroom under the pills, each judged at its own depth along the view.
 * The fight's box backs off no further than the arena reaches (`arenaReach`,
 * #652), but the fighters fit (#142) up to `maxFitDistance`: past that the
 * camera stops, inside the sky dome (#234), and on the thinnest stage bands
 * (a notched iPhone's boss fight) a tall boss's head tucks under the plate.
 * On a portrait phone the reach is far beyond what any fight needs;
 * there `battleScale` and the ground's size keep the camera over the arena
 * (camera-director.test.ts), and the reach binds only where the ground shows
 * to the screen's bottom (a wide iPad).
 */
export function frameDistance(
  aspect: number,
  safe: SafeRegion,
  fit: readonly FitPoint[],
  config: BattleCameraConfig = BATTLE_CAMERA,
): { distance: number; shift: number } {
  const tan = Math.tan(config.fov / 2);
  const feetY = Math.min(config.feetY, safe.bottom - 0.08);
  const headroom = Math.max(0.15, (feetY - safe.top - 0.03) * 2);
  const yc = Math.cos(config.yaw);
  const ys = Math.sin(config.yaw);
  const cp = Math.cos(config.pitch);
  const wide = tan * Math.max(0.3, aspect);
  const box = Math.max(config.fitHeight / (tan * headroom), config.fitHalfWidth / (wide * 0.95));
  let distance = 0;
  for (const f of fit) {
    const dx = f.x - config.aim.x;
    const dz = f.z - config.aim.z;
    // Along the view (ground-projected) and across it.
    const along = (dx * ys + dz * yc) * cp;
    const across = Math.abs(dx * yc - dz * ys) + f.r;
    distance = Math.max(distance, across / (wide * 0.94) + along);
    distance = Math.max(distance, f.h / (tan * headroom) + along);
  }
  const shift = 1 - 2 * feetY;
  const reach = arenaReach(aspect, safe.floor ?? safe.bottom, shift, config);
  // Capped (#234): past the sky dome the dome hides everything, past the fog the ground goes flat.
  return {
    distance: Math.min(config.maxFitDistance, Math.max(distance, Math.min(box, reach))),
    shift,
  };
}

/**
 * The arena fog for a shot `distance` back (#234): the mood's own fog
 * (`base`, start and end) at the usual framing distance or closer, pushed back
 * by however far past `fogReference` the camera sits, so the fighters' ground
 * keeps the look it was tuned with. Writes into `out` and returns it.
 */
export function fogFor(
  base: readonly [number, number],
  distance: number,
  out: [number, number] = [0, 0],
  config: BattleCameraConfig = BATTLE_CAMERA,
): [number, number] {
  const extra = Math.max(0, distance - config.fogReference);
  out[0] = base[0] + extra;
  out[1] = base[1] + extra;
  return out;
}

/**
 * How far back the camera may sit before the picture looks past the ground's
 * rim (#652). The lowest row of the stage that shows (`floor`, a fraction of
 * the screen height: the opaque sheet's top edge, or the screen's bottom
 * beside a narrow sheet); its two ends, cast down onto the ground (y = 0) through the lens shift, must land
 * `rimMargin` inside the disc. Each end's ground point moves in a straight
 * line as the camera backs off, so the limit is one quadratic per end.
 */
export function arenaReach(
  aspect: number,
  floor: number,
  shift: number,
  config: BattleCameraConfig = BATTLE_CAMERA,
  groundRadius: number = ARENA_STAGE.groundRadius,
): number {
  const tan = Math.tan(config.fov / 2);
  const sp = Math.sin(config.pitch);
  const cp = Math.cos(config.pitch);
  const sy = Math.sin(config.yaw);
  const cy = Math.cos(config.yaw);
  const limit = Math.max(1, groundRadius - config.rimMargin);
  // The row's rays: forward + across · right + (v − shift) · tan · up.
  const b = (1 - 2 * floor - shift) * tan;
  const dy = -sp + b * cp;
  // A row that never comes down to the ground can't see the rim.
  if (dy >= -1e-6) return config.maxDistance;
  let reach = config.maxDistance;
  for (const side of [-1, 1]) {
    const a = side * tan * Math.max(0.3, aspect);
    const dx = sy * cp + a * cy + b * sy * sp;
    const dz = cy * cp - a * sy + b * cy * sp;
    // Ground point = aim − aim.y · D / Dy + d · (−forward − sin(pitch) · D / Dy).
    const ox = config.aim.x - (config.aim.y * dx) / dy;
    const oz = config.aim.z - (config.aim.y * dz) / dy;
    const vx = -sy * cp - (sp * dx) / dy;
    const vz = -cy * cp - (sp * dz) / dy;
    // |o + d · v| = limit, the far root.
    const qa = vx * vx + vz * vz;
    const qb = 2 * (ox * vx + oz * vz);
    const qc = ox * ox + oz * oz - limit * limit;
    reach = Math.min(reach, (-qb + Math.sqrt(Math.max(0, qb * qb - 4 * qa * qc))) / (2 * qa));
  }
  return Math.max(config.minDistance, reach);
}

/**
 * How far (a fraction of the screen height, + is down) the picture must
 * slide so a face from `high` to `low` (screen fractions from the top) sits
 * `margin` inside the stage band (#868). The top edge (the eyes) wins when
 * the face is taller than the band; a face already inside needs nothing.
 */
export function faceDrop(high: number, low: number, safe: SafeRegion, margin: number): number {
  const top = safe.top + margin;
  const bottom = safe.bottom - margin;
  if (high < top) return top - high;
  if (low > bottom) return Math.max(top - high, bottom - low);
  return 0;
}

/**
 * True when the stage band is too short for the boss's face and the team's
 * eyes at once (#868: a notched iPhone's boss fight), so the team cards fade
 * while the boss acts (`BOSS_CARDS`).
 */
export function shortBand(safe: SafeRegion, short: number = BOSS_CARDS.shortBand): boolean {
  return safe.bottom - safe.top < short;
}

/**
 * The slide's target (#868), every rule in one place. `face` is the boss
 * face's own slide (`faceDrop`), `floor` the least that keeps its eyes under
 * the plate (`band top − eyes`), `cap` the most before the team's eyes reach
 * the band's bottom. In the usual band (`open` false) the boss's eyes win:
 * face, then the cap, then the floor. While the team cards are faded (`open`,
 * the band reaching down to the sheet) the team's eyes win: face, then the
 * floor, then the cap. A face that needs no slide down needs no rules.
 */
export function slideWant(face: number, floor: number, cap: number, open: boolean): number {
  if (!(face > 0)) return face;
  const room = Math.max(0, cap);
  return open ? Math.min(Math.max(face, floor), room) : Math.max(Math.min(face, room), floor);
}

/**
 * The eased slide after the rising-face hold (#868): easing never leaves the
 * boss's eyes under the plate (`floor` > 0), except while the cards are faded
 * (`open`), when the team's eyes (`cap`) come first.
 */
export function holdDrop(drop: number, floor: number, cap: number, open: boolean): number {
  const held = floor > 0 ? Math.max(drop, floor) : drop;
  return open ? Math.min(held, Math.max(0, cap)) : held;
}

const NO_SHAKE = { x: 0, y: 0 } as const;

/** A shake's offset `age` ms after it started: a quick wobble that dies away. */
export function shakeOffset(
  amount: number,
  age: number,
  config: BattleCameraConfig = BATTLE_CAMERA,
): { x: number; y: number } {
  if (amount <= 0 || age < 0) return NO_SHAKE;
  const t = age / 1000;
  const fade = Math.exp(-config.shakeDecay * t);
  if (fade < 0.01) return NO_SHAKE;
  const w = Math.PI * 2 * config.shakeHz * t;
  return { x: amount * fade * Math.sin(w), y: amount * fade * 0.6 * Math.sin(w * 1.37 + 1.1) };
}

export class CameraDirector {
  readonly #config: BattleCameraConfig;
  readonly #reduced: boolean;
  /** Where each fighter stands (ground points), to lean towards. */
  readonly #homes: Readonly<Record<'a' | 'b', { x: number; z: number }>>;
  #focus = { x: 0, z: 0 };
  #push = 0;
  #want = { focusX: 0, focusZ: 0, push: 0 };
  #pushAt = 0;
  #shake = { amount: 0, roll: 0, at: 0 };
  #last: number | null = null;
  /** The face-first slide (#868), eased like the push so a windup never jolts the frame. */
  #drop = 0;
  #dropWant = 0;
  /** The band the face and the team's eyes may use this shot, reused (#868). */
  readonly #band = { top: 0, bottom: 1 };
  /**
   * Where the last shot put the boss's face (#868), as fractions of the
   * screen height from the top (NaN with no face): the dev hook's check.
   */
  readonly face = { high: Number.NaN, low: Number.NaN };
  /** Where the last shot put the near team's faces (#868), like `face`. */
  readonly team: { high: number; low: number }[] = [];
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
    config: BattleCameraConfig = BATTLE_CAMERA,
  ) {
    this.#homes = homes;
    this.#reduced = reduced;
    this.#config = config;
  }

  /** A new step's camera beat, starting at `now` (ms). */
  cue(cue: CameraCue, now: number, at?: { x: number; z: number }): void {
    const shift = this.#config.focusShift * (this.#reduced ? 0.4 : 1);
    // `at`: the one fighter of a team the beat is about (#190), else the side's home.
    const home = cue.focus ? (at ?? this.#homes[cue.focus]) : null;
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

  /**
   * Leans the framing towards a ground point and holds it (the team picker's
   * squishy, #190: the camera nudges to each one in turn), or back to the
   * middle with null.
   */
  lean(at: { x: number; z: number } | null): void {
    const shift = this.#config.focusShift * (this.#reduced ? 0.4 : 1);
    this.#want = {
      focusX: at ? (at.x - this.#config.aim.x) * shift : 0,
      focusZ: at ? (at.z - this.#config.aim.z) * shift : 0,
      push: 0,
    };
  }

  /** Back to framing both fighters (the turn is over). */
  rest(): void {
    this.#want = { focusX: 0, focusZ: 0, push: 0 };
  }

  /** True while the face-first slide (#868) is still easing towards its target. */
  get settling(): boolean {
    return Math.abs(this.#drop - this.#dropWant) > 0.001;
  }

  /** True while the camera is still travelling or shaking (keep drawing). */
  moving(now: number): boolean {
    const shaking = shakeOffset(this.#shake.amount, now - this.#shake.at, this.#config);
    return (
      Math.abs(this.#focus.x - this.#want.focusX) > 0.002 ||
      Math.abs(this.#focus.z - this.#want.focusZ) > 0.002 ||
      Math.abs(this.#push - (now >= this.#pushAt ? this.#want.push : this.#push)) > 0.001 ||
      shaking.x !== 0 ||
      Math.abs(this.#drop - this.#dropWant) > 0.001
    );
  }

  /**
   * The camera at `now` for a screen of `aspect` (width / height), keeping
   * `fit` inside `safe`; in a boss fight the boss's `face` comes first
   * (#868): the picture slides down (lens shift, so the distance, the dome
   * cap and the fog stay as they were) until its eyes and mouth are inside
   * the band. The near `team`'s faces cap the slide: their eyes stay above
   * the team cards (only feet and bodies tuck under), and when both can't
   * have the margin the boss gives up its own, never its eyes. While the
   * team cards are faded (`open`: the lowest row the team's eyes may reach,
   * the sheet's top) the band reaches down to it and the team's eyes win
   * (`slideWant`). A boss turned away (`face.facing` under `faceFacingMin`)
   * isn't framed: the slide holds its last target. The result is reused next
   * call.
   */
  shot(
    now: number,
    aspect: number,
    safe: SafeRegion,
    fit: readonly FitPoint[],
    face: FacePoint | null = null,
    team: readonly FacePoint[] = [],
    open: number | null = null,
  ): CameraShot {
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
    shot.distance = distance;
    shot.shift = frame.shift;
    let want = 0;
    let high = Number.NaN;
    let low = Number.NaN;
    let floor = 0;
    let cap = Infinity;
    const opened = open !== null;
    // The band the face and the team's eyes may use: to the sheet while the cards are faded.
    const band = this.#band;
    band.top = safe.top;
    band.bottom = opened ? Math.max(safe.bottom, open) : safe.bottom;
    // A face behind the camera can't be framed (and would poison the easing).
    const seen =
      face !== null &&
      Number.isFinite(screenY(shot, face.x, face.high, face.z)) &&
      Number.isFinite(screenY(shot, face.x, face.low, face.z));
    // Turned away (a taunt's twirl): no eyes to frame, so hold the last target.
    const away = seen && (face.facing ?? 1) < this.#config.faceFacingMin;
    if (face && seen) {
      high = screenY(shot, face.x, face.high, face.z);
      low = screenY(shot, face.x, face.low, face.z);
      floor = safe.top - high;
      // The team's eyes stay above the cards (or the sheet, cards faded): the slide stops at their line.
      for (let i = 0; i < team.length; i++) {
        const t = team[i];
        if (!t) continue;
        const y = screenY(shot, t.x, t.low, t.z);
        if (Number.isFinite(y)) cap = Math.min(cap, band.bottom - this.#config.faceMargin - y);
      }
      want = away
        ? // The last target is its own floor: kept whole, under the cap only with the cards faded.
          slideWant(this.#dropWant, this.#dropWant, cap, opened)
        : slideWant(faceDrop(high, low, band, this.#config.faceMargin), floor, cap, opened);
    }
    // Snappy when the face rises out of the band (a windup's lift), gentle back.
    const ease = want > this.#drop ? Math.min(1, k * 3) : k;
    this.#dropWant = want;
    this.#drop += (want - this.#drop) * ease;
    // Easing never lets the eyes slip under the plate: a rising face (a windup's
    // power-up) is held at least at the band's top, whatever the lag (`holdDrop`).
    if (seen && !away) this.#drop = holdDrop(this.#drop, floor, cap, opened);
    if (Math.abs(this.#drop) < 1e-5) this.#drop = 0;
    // y = (1 − (v + shift)) / 2: sliding the picture down by `drop` lowers the shift by twice it.
    shot.shift = frame.shift - 2 * this.#drop;
    this.face.high = away ? Number.NaN : high + this.#drop;
    this.face.low = away ? Number.NaN : low + this.#drop;
    // The team's faces where the shot put them (the dev hook's check), reused.
    this.team.length = Math.min(this.team.length, team.length);
    for (let i = 0; i < team.length; i++) {
      const t = team[i];
      if (!t) continue;
      const box = (this.team[i] ??= { high: 0, low: 0 });
      box.high = screenY(shot, t.x, t.high, t.z);
      box.low = screenY(shot, t.x, t.low, t.z);
    }
    return shot;
  }
}

/**
 * Where the world point (x, y, z) lands for `shot`, as a fraction of the
 * screen height from the top, before the shot's lens shift. A point behind
 * the camera reads as far off the top.
 */
function screenY(shot: CameraShot, x: number, y: number, z: number): number {
  // Scalars only: this runs every frame of a boss fight.
  let fx = shot.target.x - shot.position.x;
  let fy = shot.target.y - shot.position.y;
  let fz = shot.target.z - shot.position.z;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // right = up × forward, then the true up = forward × right.
  let rx = shot.up.y * fz - shot.up.z * fy;
  let ry = shot.up.z * fx - shot.up.x * fz;
  let rz = shot.up.x * fy - shot.up.y * fx;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const ux = fy * rz - fz * ry;
  const uy = fz * rx - fx * rz;
  const uz = fx * ry - fy * rx;
  const dx = x - shot.position.x;
  const dy = y - shot.position.y;
  const dz = z - shot.position.z;
  const depth = dx * fx + dy * fy + dz * fz;
  if (depth <= 1e-6) return -Infinity;
  const v = (dx * ux + dy * uy + dz * uz) / (depth * Math.tan(shot.fov / 2));
  return (1 - (v + shot.shift)) / 2;
}
