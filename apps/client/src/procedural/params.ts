import {
  deriveSeed,
  hashString,
  Rng,
  HEAD_SLOTS,
  SURFACE_SLOTS,
  type Body,
  type Finish,
  type PaletteRole,
  type Part,
  type PartShape,
  type PartSlot,
  type Pose,
  type SpeciesVisual,
  type VisualRegistry,
} from '@heartpatch/shared';
import { FIXED_COLORS, VARIATION } from './config.js';

/**
 * Turns `(species, instanceId)` into everything that makes one squishy look
 * like itself: proportions, colours, part placements and breathing. Pure and
 * seeded (no Babylon, no DOM, no clock), so the same inputs always give the
 * same squishy for every player.
 *
 * Only `+ − × ÷` and the seeded `Rng` are used here, never `Math.sin` or
 * `Math.pow`, so the parameters (and `paramsHash`) are bit-identical in V8
 * and Safari's JavaScriptCore. Trigonometry happens later, in mesh building.
 */

export type Vec3 = readonly [number, number, number];
/** sRGB, each channel 0–1. */
export type Rgb = readonly [number, number, number];

/** What the generator needs from a species: its id (for seeding) and its visual. */
export interface SquishySpecies {
  readonly id: string;
  readonly visual: SpeciesVisual;
}

export interface PartPlacement {
  /** Radians around the body from the face; positive is towards +x (the viewer's right). */
  readonly around: number;
  /** Radians up the body: −π/2 bottom, 0 middle, π/2 top. */
  readonly up: number;
  /** `[width, length, thickness]` in world units. */
  readonly size: Vec3;
  /** Lean towards the top, radians (sticking-out parts). */
  readonly tilt: number;
  /** Outward lean (sticking-out) or turn (surface), radians, before `side` is applied. */
  readonly splay: number;
  /** Which way "outwards" is: −1 left, 1 right, 0 a centred or scattered part. */
  readonly side: -1 | 0 | 1;
  /** A piece of a `chain` layout: its index, and the chain's step, curl and wave (radians) and shrink. */
  readonly chain?: {
    readonly index: number;
    readonly step: number;
    readonly curl: number;
    readonly wave: number;
    readonly shrink: number;
  };
}

export interface PartParams {
  readonly id: string;
  readonly slot: PartSlot;
  readonly shape: PartShape;
  /** Sits on the head (face, ears, horns, crown, mane) or the torso. */
  readonly host: 'body' | 'head';
  /** Lies flat on the body instead of sticking out. */
  readonly surface: boolean;
  readonly color: Rgb;
  /** Fraction of the part's depth sunk into the body. */
  readonly sink: number;
  /** Extra distance out from the surface, world units (eye glints sit on the eye). */
  readonly lift: number;
  readonly flip: boolean;
  /** Lit from inside (the species' `glow`: every non-face part, or only `accent` ones). */
  readonly glow: boolean;
  readonly placements: readonly PartPlacement[];
}

export interface SquishyParams {
  readonly speciesId: string;
  readonly instanceId: string;
  readonly body: {
    readonly id: string;
    /** Multiplier on the body's registry dimensions (species size × per-squishy jitter). */
    readonly scale: Vec3;
    /** Bodies are always the primary colour. */
    readonly color: Rgb;
    readonly glow: boolean;
  };
  /** A separate head on the torso, or null when the body is head and torso in one. */
  readonly head: {
    readonly id: string;
    readonly scale: Vec3;
    /** Where the head's ground point sits, relative to the squishy's ground point. */
    readonly offset: Vec3;
  } | null;
  /** How far the torso stands off the ground (legs reach down to it), world units. */
  readonly lift: number;
  /** Rarity material tier (ART_BIBLE §1.4) for the body and sticking-out parts. */
  readonly finish: Finish;
  /** How it stands and what a move animation swings (the battle-feel lane). */
  readonly pose: Pose;
  readonly attackPart: PartSlot | null;
  /** World height of this squishy, from the ground to the top of its torso or head. */
  readonly height: number;
  readonly parts: readonly PartParams[];
  readonly motion: {
    /** Breathing phase, 0–1. */
    readonly phase: number;
    /** Breaths per second. */
    readonly rate: number;
    /** Breathing squash as a fraction of height. */
    readonly amplitude: number;
  };
  /** Body or part ids the registry doesn't know (an outdated client); drawn without them. */
  readonly missing: readonly string[];
}

const DEG = Math.PI / 180;

const surfaceSlots: ReadonlySet<PartSlot> = new Set(SURFACE_SLOTS);

function between(rng: Rng, min: number, max: number): number {
  return min + rng.next() * (max - min);
}

/** A value in `[-spread, spread]`. */
function wobble(rng: Rng, spread: number): number {
  return (rng.next() * 2 - 1) * spread;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function hexToRgb(hex: string): Rgb {
  const channel = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return [channel(1), channel(3), channel(5)];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Palette roles for a species, with per-squishy lightness and warmth. */
function paletteColors(
  palette: readonly string[],
  inkHex: string | undefined,
  rng: Rng,
): Record<PaletteRole, Rgb> {
  // The default ink tints a missing accent; a species' own (cream) ink is for the face only.
  const ink = hexToRgb(FIXED_COLORS.ink);
  const white = hexToRgb(FIXED_COLORS.white);
  const primary = hexToRgb(palette[0] ?? FIXED_COLORS.white);
  // A missing colour falls back to a lighter or deeper take on the one before,
  // so a one-colour species still has visible patches and horns.
  const secondary = palette[1] ? hexToRgb(palette[1]) : mix(primary, white, 0.55);
  const accent = palette[2] ? hexToRgb(palette[2]) : mix(primary, ink, 0.25);
  const detail = palette[3] ? hexToRgb(palette[3]) : accent;

  const light = 1 + wobble(rng, VARIATION.lightness);
  const warm = wobble(rng, VARIATION.warmth);
  const vary = (c: Rgb): Rgb => [
    clamp01(c[0] * light + warm),
    clamp01(c[1] * light),
    clamp01(c[2] * light - warm),
  ];
  return {
    primary: vary(primary),
    secondary: vary(secondary),
    accent: vary(accent),
    detail: vary(detail),
    ink: inkHex ? hexToRgb(inkHex) : ink,
    white,
    blush: hexToRgb(FIXED_COLORS.blush),
  };
}

function placementsFor(part: Part, height: number, rng: Rng): PartPlacement[] {
  const jitter = 1 + wobble(rng, part.jitter);
  const size: Vec3 = [
    part.size[0] * height * jitter,
    part.size[1] * height * jitter,
    part.size[2] * height * jitter,
  ];
  const tilt = (part.tilt ?? 0) * DEG;
  const splay = (part.splay ?? 0) * DEG;
  const { layout } = part;

  if (layout.kind === 'ring' || layout.kind === 'row') {
    const out: PartPlacement[] = [];
    for (let i = 0; i < layout.count; i++) {
      const a =
        layout.kind === 'ring'
          ? part.around - layout.spread + ((i + 0.5) * 2 * layout.spread) / layout.count
          : part.around;
      const u =
        layout.kind === 'row'
          ? part.up + ((layout.to - part.up) * i) / (layout.count - 1)
          : part.up;
      out.push({ around: a * DEG, up: u * DEG, size, tilt, splay: 0, side: 0 });
    }
    return out;
  }
  if (layout.kind === 'quad') {
    const front = part.around * DEG;
    const back = (180 - part.around) * DEG;
    const u = part.up * DEG;
    return [
      { around: -front, up: u, size, tilt, splay, side: -1 },
      { around: front, up: u, size, tilt, splay, side: 1 },
      { around: -back, up: u, size, tilt, splay, side: -1 },
      { around: back, up: u, size, tilt, splay, side: 1 },
    ];
  }
  if (layout.kind === 'chain') {
    const out: PartPlacement[] = [];
    let k = 1;
    for (let i = 0; i < layout.count; i++) {
      out.push({
        around: part.around * DEG,
        up: part.up * DEG,
        size: [size[0] * k, size[1] * k, size[2] * k],
        tilt,
        splay: 0,
        side: 0,
        chain: {
          index: i,
          step: layout.step,
          curl: layout.curl * DEG,
          wave: layout.wave * DEG,
          shrink: layout.shrink,
        },
      });
      k *= layout.shrink;
    }
    return out;
  }
  if (layout.kind === 'scatter') {
    const placed: { a: number; u: number }[] = [];
    const out: PartPlacement[] = [];
    const spacing = VARIATION.scatterSpacingDeg * VARIATION.scatterSpacingDeg;
    for (let i = 0; i < layout.count; i++) {
      // Every squishy of a species gets all `count` pieces: a piece that finds
      // no clear spot in its tries takes its last one, a little crowded.
      let a = 0;
      let u = 0;
      for (let attempt = 0; attempt < VARIATION.scatterTries; attempt++) {
        a = part.around + wobble(rng, layout.aroundRange);
        u = Math.max(-80, Math.min(80, part.up + wobble(rng, layout.upRange)));
        const clear = placed.every((p) => (p.a - a) * (p.a - a) + (p.u - u) * (p.u - u) >= spacing);
        if (clear) break;
      }
      placed.push({ a, u });
      const pieceScale = 1 + wobble(rng, part.jitter);
      out.push({
        around: a * DEG,
        up: u * DEG,
        size: [size[0] * pieceScale, size[1] * pieceScale, size[2] * pieceScale],
        tilt,
        splay: 0,
        side: 0,
      });
    }
    return out;
  }

  // Single and paired parts get one wobble, mirrored on both sides, so faces stay symmetric.
  const a = (part.around + wobble(rng, VARIATION.placementDeg)) * DEG;
  const u = (part.up + wobble(rng, VARIATION.placementDeg)) * DEG;
  if (layout.kind === 'single') {
    return [{ around: part.around === 0 ? 0 : a, up: u, size, tilt, splay, side: 0 }];
  }
  return [
    { around: -a, up: u, size, tilt, splay, side: -1 },
    { around: a, up: u, size, tilt, splay, side: 1 },
  ];
}

/** A small white glint on each eye, up and towards the viewer's left (one light, both eyes). */
function glintFor(eye: PartParams, white: Rgb, height: number): PartParams {
  return {
    id: `${eye.id}-glint`,
    slot: eye.slot,
    shape: 'ellipsoid',
    host: eye.host,
    surface: true,
    color: white,
    sink: 0,
    glow: false,
    lift: eye.placements[0] ? eye.placements[0].size[2] * (1 - eye.sink) * 0.75 : 0,
    flip: false,
    placements: eye.placements.map((p) => ({
      ...p,
      // Offsets in radians on a body about `height` tall: roughly a third of the eye.
      around: p.around - (p.size[0] / height) * 0.35,
      up: p.up + (p.size[1] / height) * 0.55,
      size: [p.size[0] * 0.38, p.size[1] * 0.34, p.size[2] * 0.4],
      splay: 0,
    })),
  };
}

function fallbackBody(registry: VisualRegistry): Body {
  for (const body of registry.bodies.values()) return body;
  throw new Error('The visual registry has no bodies');
}

/** Everything that makes this squishy look like itself. */
export function squishyParams(
  species: SquishySpecies,
  instanceId: string,
  registry: VisualRegistry,
): SquishyParams {
  const { visual } = species;
  const seed = deriveSeed('squishy', species.id, instanceId);
  const stream = (label: string) => Rng.fromSeed(deriveSeed(seed, label));
  const missing: string[] = [];

  const known = registry.bodies.get(visual.body);
  if (!known) missing.push(visual.body);
  const body = known ?? fallbackBody(registry);

  const size = visual.size ?? 1;
  const shape = stream('body');
  const scale: Vec3 = [
    size * (1 + wobble(shape, body.jitter)),
    size * (1 + wobble(shape, body.jitter)),
    size * (1 + wobble(shape, body.jitter)),
  ];
  // Parts scale with the species' size, not this squishy's proportions, so
  // a slightly taller squishy doesn't get taller eyes.
  const partHeight = body.height * size;
  const lift = (visual.stance ?? 0) * partHeight;

  // A separate head: face, ears, horns, crown and mane scale with it.
  let head: SquishyParams['head'] = null;
  let headHeight = partHeight;
  if (visual.head) {
    const headBody = registry.bodies.get(visual.head.body);
    if (!headBody) missing.push(visual.head.body);
    else {
      headHeight = visual.head.size * partHeight;
      const k = headHeight / headBody.height;
      head = {
        id: headBody.id,
        scale: [k, k, k],
        offset: [0, lift + visual.head.up * partHeight, -visual.head.forward * partHeight],
      };
    }
  }
  const headSlots: ReadonlySet<PartSlot> = new Set(head ? HEAD_SLOTS : []);
  const colors = paletteColors(visual.palette, visual.ink, stream('colors'));

  const parts: PartParams[] = [];
  for (const id of visual.parts) {
    const part = registry.parts.get(id);
    if (!part) {
      missing.push(id);
      continue;
    }
    // Each part has its own stream, so adding a part never moves the others.
    const host = headSlots.has(part.slot) ? 'head' : 'body';
    const hostHeight = host === 'head' ? headHeight : partHeight;
    const params: PartParams = {
      id: part.id,
      slot: part.slot,
      shape: part.shape,
      host,
      surface: surfaceSlots.has(part.slot),
      color: colors[part.color],
      sink: part.sink ?? 0,
      lift: 0,
      flip: part.flip ?? false,
      glow:
        !surfaceSlots.has(part.slot) &&
        (visual.glow === 'body' || (visual.glow === 'accent' && part.color === 'accent')),
      placements: placementsFor(part, hostHeight, stream(`part:${part.id}`)),
    };
    parts.push(params);
    if (part.highlight) parts.push(glintFor(params, colors.white, hostHeight));
  }

  const motion = stream('motion');
  return {
    speciesId: species.id,
    instanceId,
    body: { id: body.id, scale, color: colors.primary, glow: visual.glow === 'body' },
    head,
    lift,
    finish: visual.finish ?? 'vinyl',
    pose: visual.pose ?? 'sit',
    attackPart: visual.attackPart ?? null,
    height: Math.max(lift + body.height * scale[1], head ? head.offset[1] + headHeight : 0),
    parts,
    motion: {
      phase: motion.next(),
      rate: between(motion, VARIATION.breathRate.min, VARIATION.breathRate.max),
      amplitude: between(motion, VARIATION.breathAmplitude.min, VARIATION.breathAmplitude.max),
    },
    missing,
  };
}

/**
 * A stable fingerprint of a squishy's parameters (32 hex characters), the
 * same on every engine. Tests and the gallery hook compare these instead of
 * pixels.
 */
export function paramsHash(params: SquishyParams): string {
  return hashString(JSON.stringify(params));
}
