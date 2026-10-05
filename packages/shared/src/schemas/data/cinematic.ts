import { z } from 'zod';
import { hexKey, hexSpiral, HexSchema } from '../../hex/index.js';
import { findAvoidedWords } from '../../data/avoided-words.js';
import type { GameData } from './game-data.js';
import type { KeeperData } from './keepers.js';
import { ContentIdSchema } from './common.js';
import { checkRef, checkUniqueIds, formatDataIssues, type Path, type Report } from './issues.js';

// The opening cinematic, "The Great Scatter" (design doc §25; tech spec §6
// "Cinematic player"). A timeline described in data: shots with a duration,
// camera keyframes, actors and their paths, captions, audio cues and the
// mood (colour drain, night). The client plays it live in Babylon with the
// procedural squishies, Keepers and terrain: no video files. Retiming a
// shot, rewording a caption or moving an actor never needs engine code
// (CLAUDE.md rule 5). Times are seconds from the start of the shot; places
// are world units on the client's ground (y up, the camera's −z is "away").

/** A point in world units. */
const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

const TimeSchema = z.number().min(0);

/** Where the camera is at `at`; poses between keys ease smoothly. */
export const CinematicCameraKeySchema = z.strictObject({
  at: TimeSchema,
  position: Vec3Schema,
  target: Vec3Schema,
  /** Vertical field of view, radians. Default `CINEMATIC_DEFAULT_FOV`. */
  fov: z.number().min(0.2).max(1.6).optional(),
  /** Jump here instead of easing from the key before (a cut, or a dissolve). */
  cut: z.boolean().optional(),
});
export type CinematicCameraKey = z.infer<typeof CinematicCameraKeySchema>;

export const CINEMATIC_DEFAULT_FOV = 0.8;

/**
 * Narration. Large, rounded DOM text (style guide §6); a tap jumps to the
 * next caption. Each caption stays up long enough to read (checked below).
 */
export const CinematicCaptionSchema = z.strictObject({
  at: TimeSchema,
  until: TimeSchema,
  text: z.string().trim().min(1).max(80),
});
export type CinematicCaption = z.infer<typeof CinematicCaptionSchema>;

/** A sound moment. Names are the client's audio cues (checked by its tests). */
export const CinematicCueSchema = z.strictObject({ at: TimeSchema, cue: ContentIdSchema });
export type CinematicCue = z.infer<typeof CinematicCueSchema>;

/**
 * The world's mood, 0–1: `drain` takes colour away (shots 4–6), `night` dims
 * the light, and `glow` is how brightly the Heartpatch's ground shines
 * (gone once it shatters).
 */
export const CinematicMoodKeySchema = z.strictObject({
  at: TimeSchema,
  drain: z.number().min(0).max(1),
  night: z.number().min(0).max(1),
  glow: z.number().min(0).max(1),
});
export type CinematicMoodKey = z.infer<typeof CinematicMoodKeySchema>;

/** Music under a shot: one of the client's loops, or `none` (the music drops out). */
export const CinematicMusicSchema = z.enum(['wonder', 'day', 'night', 'halloween', 'none']);
export type CinematicMusic = z.infer<typeof CinematicMusicSchema>;

/**
 * Who is on screen. Every kind is drawn with the game's own procedural
 * builders: squishies, Keepers (`player-keeper` is the player's own), the
 * Hollow Man, Heart Seeds, Hearthfires, and the Heart Seeds' shards. "Your
 * part" adds a tossed `heart-charm`, a puff of `hearts` rising from where it
 * stands (care, a new friend), and `joy`: a squishy's glow as a little warm
 * light, which the Hollow Man pulls out in the Scatter and care brings back.
 */
export const CinematicActorKindSchema = z.enum([
  'squishy',
  'keeper',
  'player-keeper',
  'hollow-man',
  'heart-seed',
  'hearthfire',
  'shards',
  'heart-charm',
  'hearts',
  'joy',
]);
export type CinematicActorKind = z.infer<typeof CinematicActorKindSchema>;

/**
 * A pose on an actor's path. Numbers ease from the key before; `lit` steps.
 * An actor is on screen from its first key to its last.
 */
export const CinematicActorKeySchema = z.strictObject({
  at: TimeSchema,
  x: z.number(),
  z: z.number(),
  /** Height above the ground. Default 0. */
  y: z.number().optional(),
  /** Size on top of the actor's own. Default 1. */
  scale: z.number().min(0).optional(),
  /** Heading, radians; 0 faces the default camera. Default 0. */
  yaw: z.number().optional(),
  /** See-through-ness (the Hollow Man). 0–1, default 1. */
  alpha: z.number().min(0).max(1).optional(),
  /** Glow (Heart Seeds, shards, Heart Charms, hearts, joy). 0–1, default 1. */
  glow: z.number().min(0).max(1).optional(),
  /**
   * The Hollow Man's long arms, 0 (hanging) to 1 (reaching out and down);
   * his eyes flare with it. Default 0.
   */
  reach: z.number().min(0).max(1).optional(),
  /** Hearthfires: lit or out. Default lit. */
  lit: z.boolean().optional(),
  /**
   * A quick flicker key: dropped for `prefers-reduced-motion`, so the pose
   * eases straight past it (no flashes).
   */
  flash: z.boolean().optional(),
});
export type CinematicActorKey = z.infer<typeof CinematicActorKeySchema>;

export const CinematicMoveSchema = z.enum(['jiggle', 'wobble', 'bounce']);
export type CinematicMove = z.infer<typeof CinematicMoveSchema>;

export const CinematicActorSchema = z.strictObject({
  /** Seeds a squishy's look, so the same actor looks the same every time. */
  id: ContentIdSchema,
  kind: CinematicActorKindSchema,
  /** `squishy`: which species. */
  species: ContentIdSchema.optional(),
  /** `squishy`: drawn with the Hollow's shadow look (taken to the Hollow). */
  shadow: z.boolean().optional(),
  /** `keeper`: a Keeper of old, in that base's own colours. */
  keeperBase: ContentIdSchema.optional(),
  path: z.array(CinematicActorKeySchema).min(1),
  /** Squish moves (a hop for joy, a wobble on landing). */
  moves: z.array(z.strictObject({ at: TimeSchema, move: CinematicMoveSchema })).default([]),
});
export type CinematicActor = z.infer<typeof CinematicActorSchema>;

/** A world tile the Keeper claims at `at`. */
export const CinematicClaimSchema = z.strictObject({ at: TimeSchema, hex: HexSchema });
export type CinematicClaim = z.infer<typeof CinematicClaimSchema>;

/** A camera shake: `strength` world units at its start, gone after `seconds`. */
export const CinematicShakeSchema = z.strictObject({
  at: TimeSchema,
  seconds: z.number().positive().max(2),
  strength: z.number().positive().max(0.3),
});
export type CinematicShake = z.infer<typeof CinematicShakeSchema>;

export const CinematicShotSchema = z.strictObject({
  id: ContentIdSchema,
  /** For the dev hook and the PR's shot list; never shown. */
  title: z.string().trim().min(1).max(40),
  duration: z.number().positive(),
  /** How the shot starts: a cut, or a soft dissolve through cream. */
  transition: z.enum(['cut', 'dissolve']),
  music: CinematicMusicSchema,
  camera: z.array(CinematicCameraKeySchema).min(1),
  mood: z.array(CinematicMoodKeySchema).min(1),
  captions: z.array(CinematicCaptionSchema).default([]),
  cues: z.array(CinematicCueSchema).default([]),
  actors: z.array(CinematicActorSchema).default([]),
  /** Soft dissolves inside the shot (shot 2's quick seasons), at these times. */
  dissolves: z.array(TimeSchema).default([]),
  /** The title card comes up at this time and stays to the end. */
  titleAt: TimeSchema.optional(),
  /**
   * Land the Keeper claims ("Your part"): from `at`, this world tile keeps its
   * colour however drained the shot is, popping up one by one. Only in this shot.
   */
  claims: z.array(CinematicClaimSchema).default([]),
  /** Short camera shakes (the Heartpatch breaking). None for reduced motion. */
  shakes: z.array(CinematicShakeSchema).default([]),
});
export type CinematicShot = z.infer<typeof CinematicShotSchema>;

/** Ground looks the world is painted with (the map's terrains, plus three for the story). */
export const CinematicGroundSchema = z.enum([
  'meadow',
  'forest',
  'old-forest',
  'hills',
  'lake',
  'pumpkin-fields',
  'junipers-gap',
  'heartpatch',
  'autumn',
  'snow',
]);
export type CinematicGround = z.infer<typeof CinematicGroundSchema>;

/** A patch of hex tiles around `center`; later regions paint over earlier ones. */
export const CinematicRegionSchema = z.strictObject({
  ground: CinematicGroundSchema,
  center: HexSchema,
  radius: z.number().int().min(0).max(12),
});
export type CinematicRegion = z.infer<typeof CinematicRegionSchema>;

export const CinematicSchema = z.strictObject({
  id: ContentIdSchema,
  /** The world every shot plays in: hex tiles (`hexSize` centre to corner) painted by region. */
  world: z.strictObject({
    hexSize: z.number().positive(),
    regions: z.array(CinematicRegionSchema).min(1),
  }),
  shots: z.array(CinematicShotSchema).min(1),
});
export type Cinematic = z.infer<typeof CinematicSchema>;
export type CinematicInput = z.input<typeof CinematicSchema>;

/**
 * Reading time a caption needs (style guide §6, "stay up long enough to
 * read"): a beat to notice it plus a slow 10-year-old's pace.
 */
export const CAPTION_READING = {
  /** Seconds before the first word is read. */
  noticeS: 1.2, // TUNE
  /** Seconds per word (about 150 words a minute, read aloud pace). */
  perWordS: 0.4, // TUNE
  /** Most words on screen at once (style guide §2: short lines). */
  maxWords: 12, // TUNE
} as const;

/**
 * The whole cinematic stays under two and a half minutes (design doc §25;
 * raised from 120 s for "Your part", coordinator decision 2026-10-04).
 */
export const CINEMATIC_MAX_SECONDS = 150;

export const wordsIn = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/** Seconds a caption must stay up to be read. */
export function captionReadSeconds(text: string): number {
  return CAPTION_READING.noticeS + wordsIn(text) * CAPTION_READING.perWordS;
}

function checkOrdered(
  keys: readonly { at: number }[],
  duration: number,
  path: Path,
  report: Report,
): void {
  keys.forEach((key, i) => {
    if (key.at > duration) report([...path, i, 'at'], `after the shot ends (${String(duration)}s)`);
    const before = keys[i - 1];
    if (before && key.at < before.at) report([...path, i, 'at'], 'keys must be in time order');
  });
}

function checkShot(
  shot: CinematicShot,
  s: number,
  refs: {
    species: ReadonlySet<string>;
    keeperBases: ReadonlySet<string>;
    tiles: ReadonlySet<string>;
  },
  report: Report,
): void {
  const at: Path = ['shots', s];
  checkOrdered(shot.camera, shot.duration, [...at, 'camera'], report);
  checkOrdered(shot.mood, shot.duration, [...at, 'mood'], report);
  checkOrdered(shot.cues, shot.duration, [...at, 'cues'], report);
  checkOrdered(shot.claims, shot.duration, [...at, 'claims'], report);
  checkOrdered(shot.shakes, shot.duration, [...at, 'shakes'], report);
  const claimed = new Set<string>();
  shot.claims.forEach((claim, i) => {
    const key = hexKey(claim.hex);
    if (!refs.tiles.has(key)) report([...at, 'claims', i, 'hex'], 'not a tile of the world');
    if (claimed.has(key)) report([...at, 'claims', i, 'hex'], 'claimed twice');
    claimed.add(key);
  });
  if (shot.titleAt !== undefined && shot.titleAt > shot.duration) {
    report([...at, 'titleAt'], 'after the shot ends');
  }
  shot.dissolves.forEach((t, i) => {
    if (t <= 0 || t >= shot.duration) report([...at, 'dissolves', i], 'must be inside the shot');
  });
  shot.captions.forEach((caption, i) => {
    const path = [...at, 'captions', i];
    if (caption.until > shot.duration) report([...path, 'until'], 'after the shot ends');
    const before = shot.captions[i - 1];
    if (before && caption.at < before.until) report([...path, 'at'], 'overlaps the caption before');
    const words = wordsIn(caption.text);
    if (words > CAPTION_READING.maxWords) {
      report(
        [...path, 'text'],
        `${String(words)} words; at most ${String(CAPTION_READING.maxWords)}`,
      );
    }
    const needs = captionReadSeconds(caption.text);
    if (caption.until - caption.at < needs) {
      report([...path, 'until'], `up for too short to read (needs ${needs.toFixed(1)}s)`);
    }
    const avoided = findAvoidedWords(caption.text);
    if (avoided.length > 0) report([...path, 'text'], `avoided words: ${avoided.join(', ')}`);
  });
  checkUniqueIds('actors', shot.actors, (p, m) => {
    report([...at, ...p], m);
  });
  shot.actors.forEach((actor, i) => {
    const path = [...at, 'actors', i];
    checkOrdered(actor.path, shot.duration, [...path, 'path'], report);
    checkOrdered(actor.moves, shot.duration, [...path, 'moves'], report);
    if (actor.kind === 'squishy') {
      if (actor.species === undefined) report([...path, 'species'], 'a squishy needs a species');
      checkRef(refs.species, 'species', actor.species, [...path, 'species'], report);
    } else if (actor.species !== undefined || actor.shadow !== undefined) {
      report([...path, 'species'], 'only squishies have a species');
    }
    if (actor.kind !== 'hollow-man' && actor.path.some((k) => k.reach !== undefined)) {
      report([...path, 'path'], 'only the Hollow Man reaches');
    }
    if (actor.kind === 'keeper') {
      if (actor.keeperBase === undefined) report([...path, 'keeperBase'], 'a Keeper needs a base');
      checkRef(refs.keeperBases, 'Keeper base', actor.keeperBase, [...path, 'keeperBase'], report);
    } else if (actor.keeperBase !== undefined) {
      report([...path, 'keeperBase'], 'only Keepers of old have a base');
    }
  });
}

/**
 * Checks a cinematic against the game data: every squishy is a public
 * species, every Keeper of old a real base, keys in time order inside their
 * shot, claimed land on the world's tiles, captions short, kind and up long
 * enough to read, and the whole thing under `CINEMATIC_MAX_SECONDS`. Returns readable issues (empty when fine).
 */
export function checkCinematic(
  input: unknown,
  gameData: Pick<GameData, 'species'>,
  keeperData: Pick<KeeperData, 'bases'>,
): string[] {
  const schema = CinematicSchema.superRefine((data, ctx) => {
    const report: Report = (path, message) => {
      ctx.addIssue({ code: 'custom', path, message });
    };
    const refs = {
      species: new Set(gameData.species.map((s) => s.id)),
      keeperBases: new Set(keeperData.bases.map((b) => b.id)),
      tiles: new Set(
        data.world.regions.flatMap((r) => hexSpiral(r.center, r.radius).map((h) => hexKey(h))),
      ),
    };
    checkUniqueIds('shots', data.shots, report);
    data.shots.forEach((shot, s) => {
      checkShot(shot, s, refs, report);
    });
    const total = data.shots.reduce((sum, shot) => sum + shot.duration, 0);
    if (total > CINEMATIC_MAX_SECONDS) {
      report(['shots'], `${total.toFixed(1)}s long; at most ${String(CINEMATIC_MAX_SECONDS)}s`);
    }
  });
  const result = schema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}
