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

/**
 * The camera for a fight (#190 PR 2): the boss fight's low hero shot
 * (`BATTLE_CAMERA.boss` on top of the rest) when a boss is in it, else
 * `BATTLE_CAMERA` itself, untouched.
 */
export function cameraFor(boss: boolean): Readonly<BattleCameraConfig> {
  return boss ? BOSS_FIGHT_CAMERA : BATTLE_CAMERA;
}

// The profile's framing numbers over the rest (its beats are choreography's).
const BOSS_FIGHT_CAMERA: Readonly<BattleCameraConfig> = (() => {
  const { boss, ...base } = BATTLE_CAMERA;
  const { pitch, aim, feetY, feetRoom, fitFrom, fitHeight, focusShift } = boss;
  const { mouthClear, mouthWidth, riseMax, sideKeep } = boss;
  const framing = { pitch, aim, feetY, feetRoom, fitFrom, fitHeight, focusShift };
  return { ...base, ...framing, mouthClear, mouthWidth, riseMax, sideKeep };
})();

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
  /**
   * A team friend's body radius on the ground (#190 PR 2): given, the body's
   * front edge, the lowest row it draws, stays above the band's bottom.
   */
  r?: number;
  /**
   * A team friend's top as drawn (#190 PR 6b, 5b), world units above the
   * ground: the head, ears, tuft and hat, which the eyes-only box leaves out.
   * Given, the camera keeps it under the boss's mouth (`clearRise`).
   */
  top?: number;
  /** The boss face's half width across the view (#190 PR 6b), world units; left out, 0. */
  w?: number;
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
): { distance: number; shift: number; side: number } {
  const tan = Math.tan(config.fov / 2);
  const feetY = Math.min(config.feetY, safe.bottom - config.feetRoom);
  const headroom = Math.max(0.15, (feetY - safe.top - 0.03) * 2);
  const yc = Math.cos(config.yaw);
  const ys = Math.sin(config.yaw);
  const cp = Math.cos(config.pitch);
  const wide = tan * Math.max(0.3, aspect);
  const box = Math.max(config.fitHeight / (tan * headroom), config.fitHalfWidth / (wide * 0.95));
  let distance = 0;
  // The least distance that keeps every fit point's width on screen (#190 PR 6b): a push-in stops here.
  let side = 0;
  for (const f of fit) {
    const dx = f.x - config.aim.x;
    const dz = f.z - config.aim.z;
    // Along the view (ground-projected) and across it.
    const along = (dx * ys + dz * yc) * cp;
    const across = Math.abs(dx * yc - dz * ys) + f.r;
    side = Math.max(side, across / (wide * 0.94) + along);
    distance = Math.max(distance, across / (wide * 0.94) + along);
    distance = Math.max(distance, Math.max(0, f.h - config.fitFrom) / (tan * headroom) + along);
  }
  const shift = 1 - 2 * feetY;
  const reach = arenaReach(aspect, safe.floor ?? safe.bottom, shift, config);
  // Capped (#234): past the sky dome the dome hides everything, past the fog the ground goes flat.
  return {
    distance: Math.min(config.maxFitDistance, Math.max(distance, Math.min(box, reach))),
    shift,
    side,
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
 * eyes at once (#868: a notched iPhone's boss fight under the old plate and
 * cards). The phone-first boss HUD (#190 PR 1) leaves a band well above it;
 * `faceDrop` and `holdDrop` stay as the safety net if a screen ever is short.
 */
export function shortBand(safe: SafeRegion, short: number = BOSS_CARDS.shortBand): boolean {
  return safe.bottom - safe.top < short;
}

/**
 * The slide's target (#868), every rule in one place. `face` is the boss
 * face's own slide (`faceDrop`), `floor` the least that keeps its eyes under
 * the strip (`band top − eyes`), `cap` the most before the team's eyes reach
 * the band's bottom. The boss's eyes win: face, then the cap, then the floor.
 * A face that needs no slide down needs no rules.
 */
export function slideWant(face: number, floor: number, cap: number): number {
  if (!(face > 0)) return face;
  return Math.max(Math.min(face, Math.max(0, cap)), floor);
}

/**
 * The eased slide after the rising-face hold (#868): easing never leaves the
 * boss's eyes under the strip (`floor` > 0).
 */
export function holdDrop(drop: number, floor: number): number {
  return floor > 0 ? Math.max(drop, floor) : drop;
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
  /** A slow push-in (a windup's, #190): the push ramps from `from` over `ms` from `at`, then relaxes. */
  #ramp = { at: 0, ms: 0, from: 0 };
  /** How fast this beat's push relaxes, per second. */
  #relax = 0;
  /** A held lean (a windup's roll, #190), eased in and out like the focus. */
  #tilt = 0;
  #tiltWant = 0;
  #shake = { amount: 0, roll: 0, at: 0 };
  #last: number | null = null;
  /** The face-first slide (#868), eased like the push so a windup never jolts the frame. */
  #drop = 0;
  #dropWant = 0;
  /** How far the camera has risen to keep the near friends under the boss's mouth (#190 PR 6b), eased. */
  #rise = 0;
  #riseWant = 0;
  /** The band the face and the team's eyes may use this shot, reused (#868). */
  readonly #band = { top: 0, bottom: 1 };
  /**
   * Where the last shot put the boss's face (#868), as fractions of the
   * screen height from the top (NaN with no face): the dev hook's check.
   */
  readonly face = { high: Number.NaN, low: Number.NaN };
  /** Where the last shot put the near team's faces (#868), like `face`. */
  readonly team: { high: number; low: number; top: number }[] = [];
  /** How far the last shot rose to clear the boss's mouth (#190 PR 6b), world units: the dev hook's check. */
  get rise(): number {
    return this.#rise;
  }
  /** The lowest row the near team's bodies draw in the last shot (`teamFeet`), NaN with no team: the dev hook's check. */
  feet = Number.NaN;
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
    this.#relax = config.beatDecay;
  }

  /** The tunables this camera frames with (the boss profile in a boss fight), for the fog. */
  get config(): Readonly<BattleCameraConfig> {
    return this.#config;
  }

  /** A new step's camera beat, starting at `now` (ms). */
  cue(cue: CameraCue, now: number, at?: { x: number; z: number }): void {
    const shift = this.#config.focusShift * (this.#reduced ? 0.4 : 1);
    // `at`: the one fighter of a team the beat is about (#190), else the side's home.
    const home = cue.focus ? (at ?? this.#homes[cue.focus]) : null;
    const push = this.#reduced ? 0 : cue.push;
    // A slow pull-back (the boss tuckered out, #190) outlasts the beats after it that push nothing.
    const keep = push === 0 && this.#pullingBack();
    this.#want = {
      focusX: home ? (home.x - this.#config.aim.x) * shift : 0,
      focusZ: home ? (home.z - this.#config.aim.z) * shift : 0,
      push: keep ? this.#want.push : push,
    };
    if (!keep) {
      this.#pushAt = now + cue.pushDelay;
      this.#relax = cue.relax ?? this.#config.beatDecay;
      this.#ramp.at = this.#pushAt;
      this.#ramp.ms = this.#reduced ? 0 : (cue.ramp ?? 0);
      this.#ramp.from = this.#push;
    }
    this.#tiltWant = this.#reduced ? 0 : (cue.tilt ?? 0);
    if (!this.#reduced && cue.shake > 0) {
      this.#shake = { amount: cue.shake, roll: cue.roll, at: now + cue.shakeDelay };
    }
  }

  /**
   * A push and a shake that keep the framing's lean (the entrance's stomp,
   * #190 PR 3: the picker's nudge to squishy 1 stays). None under reduced motion.
   */
  thump(push: number, shake: number, now: number): void {
    if (this.#reduced) return;
    this.#want = { ...this.#want, push };
    this.#pushAt = now;
    this.#relax = this.#config.beatDecay;
    this.#ramp.at = now;
    this.#ramp.ms = 0;
    this.#ramp.from = this.#push;
    if (shake > 0) this.#shake = { amount: shake, roll: 0, at: now };
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
      push: this.#pullingBack() ? this.#want.push : 0,
    };
    this.#calm();
  }

  /** Back to framing both fighters (the turn is over). */
  rest(): void {
    this.#want = { focusX: 0, focusZ: 0, push: this.#pullingBack() ? this.#want.push : 0 };
    this.#calm();
  }

  /** True while a slow pull-back (`CameraCue.relax`) is still easing the push out. */
  #pullingBack(): boolean {
    return this.#relax < this.#config.beatDecay && this.#want.push > 0.001;
  }

  /** No lean, and a windup's push-in stops ramping (it eases back from where it is). */
  #calm(): void {
    this.#tiltWant = 0;
    this.#ramp.ms = 0;
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
      now < this.#ramp.at + this.#ramp.ms ||
      Math.abs(this.#tilt - this.#tiltWant) > 0.0005 ||
      Math.abs(this.#drop - this.#dropWant) > 0.001 ||
      Math.abs(this.#rise - this.#riseWant) > 0.001
    );
  }

  /**
   * The camera at `now` for a screen of `aspect` (width / height), keeping
   * `fit` inside `safe`; in a boss fight the boss's `face` comes first
   * (#868): the picture slides down (lens shift, so the distance, the dome
   * cap and the fog stay as they were) until its eyes and mouth are inside
   * the band. The near `team`'s faces cap the slide: their eyes stay above
   * the team chips (only feet and bodies tuck under), and when both can't
   * have the margin the boss gives up its own, never its eyes (`slideWant`).
   * A boss turned away (`face.facing` under `faceFacingMin`)
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
  ): CameraShot {
    const dt = this.#last === null ? 1 : Math.min(0.1, Math.max(0, (now - this.#last) / 1000));
    this.#last = now;
    // Smoothly follow (frame-rate independent exponential easing).
    const k = this.#reduced ? 1 : 1 - Math.exp(-this.#config.follow * dt);
    this.#focus.x += (this.#want.focusX - this.#focus.x) * k;
    this.#focus.z += (this.#want.focusZ - this.#focus.z) * k;
    if (now >= this.#pushAt) {
      const { at, ms, from } = this.#ramp;
      if (now < at + ms) {
        // A slow push-in (a windup): eased along the step from where it was, no jump.
        const t = (now - at) / ms;
        this.#push = from + (this.#want.push - from) * t * t * (3 - 2 * t);
      } else {
        this.#push += (this.#want.push - this.#push) * Math.min(1, k * 1.6);
        // A beat relaxes on its own: the push-in eases back as the hit settles.
        this.#want.push *= Math.exp(-this.#relax * dt);
      }
    }
    this.#tilt += (this.#tiltWant - this.#tilt) * k;
    if (Math.abs(this.#tilt) < 1e-6) this.#tilt = 0;

    const { aim, pitch, yaw, fov } = this.#config;
    const frame = frameDistance(aspect, safe, fit, this.#config);
    // A push-in never crops an end friend (#190 PR 6b): in a boss fight it stops where the row's
    // width meets the screen's edges (a windup's push reached 0.18 and clipped the left one).
    const pushed = frame.distance * (1 - this.#push);
    const distance = Math.max(pushed, Math.min(frame.distance, frame.side * this.#config.sideKeep));
    const tx = aim.x + this.#focus.x;
    const tz = aim.z + this.#focus.z;
    const age = now - this.#shake.at;
    const shake = shakeOffset(this.#shake.amount, age, this.#config);
    const fade =
      this.#shake.amount > 0 && age >= 0 ? Math.exp(-this.#config.shakeDecay * (age / 1000)) : 0;
    const roll = this.#shake.roll * fade + this.#tilt;
    // Looking along +z, swung by yaw and tilted down by pitch.
    const back = Math.cos(pitch) * distance;
    const up = Math.sin(pitch) * distance;
    const shot = this.#shot;
    shot.position.x = tx - Math.sin(yaw) * back + shake.x;
    shot.position.y = aim.y + up + shake.y + this.#rise;
    shot.position.z = tz - Math.cos(yaw) * back;
    shot.target.x = tx + shake.x;
    shot.target.y = aim.y + shake.y + this.#rise;
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
    // The band the face and the team's eyes may use.
    const band = this.#band;
    band.top = safe.top;
    band.bottom = safe.bottom;
    // A face behind the camera can't be framed (and would poison the easing).
    const seen =
      face !== null &&
      Number.isFinite(screenY(shot, face.x, face.high, face.z)) &&
      Number.isFinite(screenY(shot, face.x, face.low, face.z));
    // Turned away (a taunt's twirl): no eyes to frame, so hold the last target.
    const away = seen && (face.facing ?? 1) < this.#config.faceFacingMin;
    // The near friends' heads stay under the boss's mouth (#190 PR 6b, 5b): the camera rises,
    // which lowers a near head more than the far mouth. Turned away, it holds; no boss, it settles.
    if (!face) this.#riseWant = 0;
    else if (seen && !away) this.#riseWant = clearRise(shot, face, team, this.#rise, this.#config);
    const rose = this.#rise;
    // Quick to rise (a friend hops up or the boss closes in), gentle back down, like the slide.
    this.#rise +=
      (this.#riseWant - this.#rise) * (this.#riseWant > this.#rise ? Math.min(1, k * 3) : k);
    if (Math.abs(this.#rise) < 1e-5) this.#rise = 0;
    shot.position.y += this.#rise - rose;
    shot.target.y += this.#rise - rose;
    if (face && seen) {
      high = screenY(shot, face.x, face.high, face.z);
      low = screenY(shot, face.x, face.low, face.z);
      floor = safe.top - high;
      // The team's eyes stay above the chips: the slide stops at their line.
      for (let i = 0; i < team.length; i++) {
        const t = team[i];
        if (!t) continue;
        const y = screenY(shot, t.x, t.low, t.z);
        if (Number.isFinite(y)) cap = Math.min(cap, band.bottom - this.#config.faceMargin - y);
      }
      want = away
        ? // The last target is its own floor: kept whole.
          slideWant(this.#dropWant, this.#dropWant, cap)
        : slideWant(faceDrop(high, low, band, this.#config.faceMargin), floor, cap);
      // The team's bodies stand on the band's bottom, not under it (#190 PR 2:
      // on an iPad the close camera puts the near row well below the aim, so
      // the picker card hid all but the middle friend's head). The picture
      // slides up until the lowest body's front edge is over the band's
      // bottom; the boss's eyes still win (`floor`).
      const feet = teamFeet(shot, team);
      if (feet > band.bottom)
        want = Math.max(Math.min(want, band.bottom - feet), away ? -Infinity : floor);
    }
    // Snappy when the face rises out of the band (a windup's lift), gentle back.
    const ease = want > this.#drop ? Math.min(1, k * 3) : k;
    this.#dropWant = want;
    this.#drop += (want - this.#drop) * ease;
    // Easing never lets the eyes slip under the plate: a rising face (a windup's
    // power-up) is held at least at the band's top, whatever the lag (`holdDrop`).
    if (seen && !away) this.#drop = holdDrop(this.#drop, floor);
    if (Math.abs(this.#drop) < 1e-5) this.#drop = 0;
    // y = (1 − (v + shift)) / 2: sliding the picture down by `drop` lowers the shift by twice it.
    shot.shift = frame.shift - 2 * this.#drop;
    this.face.high = away ? Number.NaN : high + this.#drop;
    this.face.low = away ? Number.NaN : low + this.#drop;
    const feet = teamFeet(shot, team);
    this.feet = Number.isFinite(feet) ? feet : Number.NaN;
    // The team's faces where the shot put them (the dev hook's check), reused.
    this.team.length = Math.min(this.team.length, team.length);
    for (let i = 0; i < team.length; i++) {
      const t = team[i];
      if (!t) continue;
      const box = (this.team[i] ??= { high: 0, low: 0, top: 0 });
      box.high = screenY(shot, t.x, t.high, t.z);
      box.low = screenY(shot, t.x, t.low, t.z);
      box.top = t.top === undefined ? Number.NaN : screenY(shot, t.x, t.top, t.z);
    }
    return shot;
  }
}

/**
 * How far the camera should rise (world units, from 0 to `riseMax`) so every
 * near friend standing in front of the boss's face has its `top` at least
 * `mouthClear` under the boss's mouth (#190 PR 6b, 5b: the middle friend's
 * head hid it). `shot` is this frame's camera, already risen by `rise`.
 * Raising the camera and its aim by Δh lowers a point `depth` away by
 * Δh / (2·depth·tan(fov/2)) of the screen, so a near head drops faster than the
 * far mouth: the gap grows by Δh·(1/dn − 1/df) / (2·tan). The answer is that
 * linear step from where the camera is (each frame refines it, which also
 * absorbs what the step leaves out: the up axis's cos(pitch)·cos(roll) and the
 * small change in depth as it rises); with no friend
 * in front of the mouth the camera comes back down.
 */
export function clearRise(
  shot: CameraShot,
  face: FacePoint,
  team: readonly FacePoint[],
  rise: number,
  config: BattleCameraConfig = BATTLE_CAMERA,
): number {
  if (!(config.riseMax > 0)) return 0;
  const tan = Math.tan(shot.fov / 2);
  const df = depthOf(shot, face.x, face.low, face.z);
  if (!(df > 1e-6)) return rise;
  const mouth = screenY(shot, face.x, face.low, face.z);
  const mx = screenX(shot, face.x, face.z, df);
  const mw = (face.w ?? 0) / (df * tan);
  let need = -Infinity;
  for (let i = 0; i < team.length; i++) {
    const t = team[i];
    if (!t || t.top === undefined) continue;
    const dn = depthOf(shot, t.x, t.top, t.z);
    // Only a friend nearer than the face can cover it.
    if (!(dn > 1e-6) || dn >= df) continue;
    const x = screenX(shot, t.x, t.z, dn);
    if (Math.abs(x - mx) > mw + (t.r ?? 0) / (dn * tan)) continue;
    const deficit = mouth + config.mouthClear - screenY(shot, t.x, t.top, t.z);
    need = Math.max(need, (2 * tan * deficit) / (1 / dn - 1 / df));
  }
  if (need === -Infinity) return 0;
  return Math.min(config.riseMax, Math.max(0, rise + need));
}

/** How far ahead of the camera (along its view) the world point (x, y, z) is. */
function depthOf(shot: CameraShot, x: number, y: number, z: number): number {
  const fx = shot.target.x - shot.position.x;
  const fy = shot.target.y - shot.position.y;
  const fz = shot.target.z - shot.position.z;
  const fl = Math.hypot(fx, fy, fz) || 1;
  return (
    ((x - shot.position.x) * fx + (y - shot.position.y) * fy + (z - shot.position.z) * fz) / fl
  );
}

/**
 * Where the world point lands across the screen, in half screen heights from
 * the middle (+ right; the roll is ignored, a small lean doesn't move a head
 * off the mouth), `depth` ahead of the camera.
 */
function screenX(shot: CameraShot, x: number, z: number, depth: number): number {
  const fx = shot.target.x - shot.position.x;
  const fz = shot.target.z - shot.position.z;
  const fl = Math.hypot(fx, fz) || 1;
  // Right on the ground: forward turned a quarter clockwise seen from above.
  const across = ((x - shot.position.x) * fz - (z - shot.position.z) * fx) / fl;
  return across / (depth * Math.tan(shot.fov / 2));
}

/**
 * The lowest row (a fraction of the screen height from the top, before the
 * shot's lens shift) any of the `team`'s bodies draws: each body's front edge
 * on the ground, `r` towards the camera. A friend with no `r` counts by its
 * feet. -Infinity with no team.
 */
export function teamFeet(shot: CameraShot, team: readonly FacePoint[]): number {
  let feet = -Infinity;
  for (let i = 0; i < team.length; i++) {
    const t = team[i];
    if (!t) continue;
    const r = t.r ?? 0;
    const cx = shot.position.x - t.x;
    const cz = shot.position.z - t.z;
    const len = Math.hypot(cx, cz) || 1;
    const y = screenY(shot, t.x + (cx / len) * r, 0, t.z + (cz / len) * r);
    if (Number.isFinite(y)) feet = Math.max(feet, y);
  }
  return feet;
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
