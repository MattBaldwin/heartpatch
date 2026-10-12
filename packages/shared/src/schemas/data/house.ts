import { z } from 'zod';
import { scanPlayerFacingText } from '../../data/avoided-words.js';
import {
  ContentIdSchema,
  DescriptionSchema,
  DisplayNameSchema,
  ResourceCostSchema,
} from './common.js';
import { FeelingIdSchema } from './elements.js';
import { formatDataIssues } from './issues.js';
import { RequirementSchema } from './requirements.js';

/*
 * The Keeper's house (#381): a walk-around dollhouse grown from the Heart
 * Seed. It has its own level, one named room per level, and the Keeper's
 * Heart Seed level caps it (owner decisions 2026-10-11). Rooms sit on a house
 * grid with floors, so the camera fits whatever the data builds and a later
 * level adds rooms and floors by data edit, never by code (plan §1c).
 */

/** The side of a room its doorway opens on, as seen from the dollhouse front (south). */
export const HouseDoorSchema = z.enum(['north', 'east', 'south', 'west']);
export type HouseDoor = z.infer<typeof HouseDoorSchema>;

/**
 * Where a room sits on the house grid: `floor` 0 is the ground, `gx`/`gy`
 * the cell of its front-left corner (x to the right, y away from the front),
 * `w`/`d` its width and depth in cells, `storeys` how many floors tall it is
 * (the Heart Hall is two).
 */
export const HouseRoomLayoutSchema = z.strictObject({
  floor: z.number().int().min(0).max(3),
  gx: z.number().int().min(-16).max(16),
  gy: z.number().int().min(-16).max(16),
  w: z.number().int().min(1).max(12),
  d: z.number().int().min(1).max(12),
  storeys: z.number().int().min(1).max(3),
  door: HouseDoorSchema,
});
export type HouseRoomLayout = z.infer<typeof HouseRoomLayoutSchema>;

/** The look a room is drawn with (`house-models.ts` on the client). */
export const HouseRoomLookSchema = z.enum(['snug', 'playroom', 'kitchen', 'heart-hall']);
export type HouseRoomLook = z.infer<typeof HouseRoomLookSchema>;

export const HouseRoomSchema = z.strictObject({
  id: ContentIdSchema,
  name: DisplayNameSchema,
  description: DescriptionSchema,
  /** Residents it sleeps. */
  beds: z.number().int().min(1).max(12),
  look: HouseRoomLookSchema,
  layout: HouseRoomLayoutSchema,
});
export type HouseRoom = z.infer<typeof HouseRoomSchema>;

/** The cottage drawn on the Heart Seed tile, bigger per level. */
export const HouseExteriorSchema = z.enum(['hut', 'wing', 'loft', 'heart-tree']);
export type HouseExterior = z.infer<typeof HouseExteriorSchema>;

export const HouseLevelSchema = z.strictObject({
  level: z.number().int().min(1),
  /** The level's name, the room it adds ("The Playroom"). */
  name: DisplayNameSchema,
  /** All must hold to unlock building it. Level 1 has none: it sprouts with the Heart Seed. */
  requirements: z.array(RequirementSchema),
  /** What building it spends. Level 1 is free. */
  cost: ResourceCostSchema,
  /** The room this level adds. */
  room: HouseRoomSchema,
  exterior: HouseExteriorSchema,
  /** The top level: it carries the celebration and the gold look (plan Q1). */
  final: z.literal(true).optional(),
});
export type HouseLevel = z.infer<typeof HouseLevelSchema>;

/** The resident perk, swappable by data (plan Q2 and its fallback). */
export const HousePerkSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('slower-drain'),
    /** A resident's happiness fades at this percent of the normal rate. */
    drainPercent: z.number().int().min(0).max(100),
  }),
  z.strictObject({
    kind: z.literal('care-bonus'),
    extraFullActions: z.number().int().min(1),
  }),
]);
export type HousePerk = z.infer<typeof HousePerkSchema>;

/** One thing a resident can leave as the day's gift, and how many (`min`..`max`). */
export const HouseGiftOptionSchema = z.strictObject({
  itemId: ContentIdSchema,
  min: z.number().int().min(1).max(99),
  max: z.number().int().min(1).max(99),
  /** How often it's picked against the others in its row. */
  weight: z.number().int().min(1),
});
export type HouseGiftOption = z.infer<typeof HouseGiftOptionSchema>;

/** The gifts a house from `fromLevel` up gives (the highest row at or under the level wins). */
export const HouseGiftRowSchema = z.strictObject({
  fromLevel: z.number().int().min(1),
  gifts: z.array(HouseGiftOptionSchema).min(1),
});
export type HouseGiftRow = z.infer<typeof HouseGiftRowSchema>;

/**
 * The daily gift (#381 PR H, plan §1c "Daily return reasons"): once a day a
 * resident at home leaves the Keeper a small resource gift, rolled on the
 * server from a seed (never by the client) and claimed once.
 */
export const HouseGiftRulesSchema = z.strictObject({
  /** Gifts a day. One: `house_gifts` holds one row per Keeper per patch day. */
  perDay: z.literal(1),
  table: z.array(HouseGiftRowSchema).min(1),
});
export type HouseGiftRules = z.infer<typeof HouseGiftRulesSchema>;

export const HouseRulesSchema = z.strictObject({
  perk: HousePerkSchema,
  /** Hours before a squishy that moved out can move back in. */
  moveBackInHours: z.number().int().min(0),
  gifts: HouseGiftRulesSchema,
});
export type HouseRules = z.infer<typeof HouseRulesSchema>;

export const HouseDataSchema = z.strictObject({
  rules: HouseRulesSchema,
  levels: z.array(HouseLevelSchema).min(1),
});
export type HouseData = z.infer<typeof HouseDataSchema>;

/** The content `checkHouseData` checks references against. */
export interface HouseDataRefs {
  buildings: readonly { id: string; kind: string }[];
  resources: readonly { id: string }[];
  milestoneTrackIds: readonly string[];
}

/** Every grid cell a room covers, as `floor:x:y`. */
function cellsOf(layout: HouseRoomLayout): string[] {
  const cells: string[] = [];
  for (let f = layout.floor; f < layout.floor + layout.storeys; f += 1) {
    for (let x = layout.gx; x < layout.gx + layout.w; x += 1) {
      for (let y = layout.gy; y < layout.gy + layout.d; y += 1) {
        cells.push(`${String(f)}:${String(x)}:${String(y)}`);
      }
    }
  }
  return cells;
}

/**
 * Validates the house data and returns readable problems, or `[]`: levels
 * run 1..n with no gaps; level 1 is free with no requirements; every later
 * level is capped by the Heart Seed; room ids are unique; rooms never
 * overlap and every upper room stands on rooms below; exactly the last level
 * is `final`; requirements and costs name real content; and no
 * player-facing text uses an avoided word (style guide §9).
 */
export function checkHouseData(input: unknown, refs: HouseDataRefs): string[] {
  const result = HouseDataSchema.safeParse(input);
  if (!result.success) return formatDataIssues(input, result.error);
  const { levels, rules } = result.data;
  const problems: string[] = [];
  // The fallback perk isn't built yet (`residentDrainPercent`): naming it
  // would quietly take the perk away.
  if (rules.perk.kind === 'care-bonus') problems.push('rules.perk: care-bonus is not built yet');
  const buildings = new Set(refs.buildings.map((b) => b.id));
  const buildingKinds = new Set(refs.buildings.map((b) => b.kind));
  const resources = new Set(refs.resources.map((r) => r.id));
  const tracks = new Set(refs.milestoneTrackIds);
  const rooms = new Set<string>();
  const filled = new Map<string, string>();

  rules.gifts.table.forEach((row, i) => {
    const at = `rules.gifts.table[${String(i)}]`;
    const before = rules.gifts.table[i - 1];
    if (i === 0 && row.fromLevel !== 1) problems.push(`${at}: the first row starts at level 1`);
    if (before && row.fromLevel <= before.fromLevel) {
      problems.push(`${at}: fromLevel should climb (${String(row.fromLevel)})`);
    }
    if (row.fromLevel > levels.length) problems.push(`${at}: no level ${String(row.fromLevel)}`);
    row.gifts.forEach((gift, j) => {
      const giftAt = `${at}.gifts[${String(j)}]`;
      if (!resources.has(gift.itemId))
        problems.push(`${giftAt}: unknown resource "${gift.itemId}"`);
      if (gift.min > gift.max) problems.push(`${giftAt}: min is more than max`);
    });
  });

  levels.forEach((lvl, i) => {
    const at = `levels[${String(i)}]`;
    if (lvl.level !== i + 1)
      problems.push(`${at}: level ${String(lvl.level)} should be ${String(i + 1)}`);
    if (i === 0) {
      if (lvl.requirements.length > 0) problems.push(`${at}: level 1 has no requirements`);
      if (Object.keys(lvl.cost).length > 0) problems.push(`${at}: level 1 is free`);
    } else if (!lvl.requirements.some((r) => r.kind === 'heartSeedLevel')) {
      problems.push(`${at}: needs a heartSeedLevel requirement (the Seed is the cap)`);
    }
    if ((lvl.final === true) !== (i === levels.length - 1)) {
      problems.push(`${at}: only the last level is final`);
    }
    if (rooms.has(lvl.room.id)) problems.push(`${at}: duplicate room id "${lvl.room.id}"`);
    rooms.add(lvl.room.id);
    for (const cell of cellsOf(lvl.room.layout)) {
      const other = filled.get(cell);
      if (other !== undefined) {
        problems.push(`${at}: room "${lvl.room.id}" overlaps "${other}"`);
        break;
      }
    }
    const { floor } = lvl.room.layout;
    for (const cell of cellsOf({ ...lvl.room.layout, storeys: 1 })) {
      if (floor === 0) break;
      const [, x, y] = cell.split(':');
      if (!filled.has(`${String(floor - 1)}:${x ?? ''}:${y ?? ''}`)) {
        problems.push(`${at}: room "${lvl.room.id}" has nothing under it`);
        break;
      }
    }
    for (const cell of cellsOf(lvl.room.layout))
      if (!filled.has(cell)) filled.set(cell, lvl.room.id);
    for (const id of Object.keys(lvl.cost)) {
      if (!resources.has(id)) problems.push(`${at}.cost: unknown resource "${id}"`);
    }
    lvl.requirements.forEach((req, j) => {
      const reqAt = `${at}.requirements[${String(j)}]`;
      if (req.kind === 'buildingsBuilt') {
        if (req.buildingId !== undefined && !buildings.has(req.buildingId))
          problems.push(`${reqAt}: unknown building "${req.buildingId}"`);
        if (req.buildingKind !== undefined && !buildingKinds.has(req.buildingKind))
          problems.push(`${reqAt}: unknown building kind "${req.buildingKind}"`);
      }
      if (req.kind === 'milestonesReached' && req.trackId !== undefined && !tracks.has(req.trackId))
        problems.push(`${reqAt}: unknown milestone track "${req.trackId}"`);
    });
  });
  problems.push(...scanPlayerFacingText(result.data, 'house'));
  return problems;
}

/**
 * A note a resident leaves with the daily gift (#381 PR H): a fixed line,
 * never free text (rule 9). `{name}` is the giver's name. A note with a
 * `feeling` goes only with a giver of that feeling; one without is for anyone.
 */
export const HouseNoteSchema = z.strictObject({
  id: ContentIdSchema,
  feeling: FeelingIdSchema.optional(),
  line: z.string().min(1).max(80),
});
export type HouseNote = z.infer<typeof HouseNoteSchema>;

export const HouseNotesSchema = z.array(HouseNoteSchema).min(1);

/** Where a note's line names the giver. */
export const HOUSE_NOTE_NAME = '{name}';

/**
 * Validates the gift notes and returns readable problems, or `[]`: ids are
 * unique, every line names the giver exactly once, there are notes for any
 * giver (no `feeling`), and no line uses an avoided word (style guide §9).
 */
export function checkHouseNotes(input: unknown): string[] {
  const result = HouseNotesSchema.safeParse(input);
  if (!result.success) return formatDataIssues(input, result.error);
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const note of result.data) {
    if (ids.has(note.id)) problems.push(`notes: duplicate id "${note.id}"`);
    ids.add(note.id);
    if (note.line.split(HOUSE_NOTE_NAME).length !== 2) {
      problems.push(`notes["${note.id}"]: the line names {name} exactly once`);
    }
  }
  if (!result.data.some((n) => n.feeling === undefined)) {
    problems.push('notes: needs at least one note for any giver (no feeling)');
  }
  problems.push(...scanPlayerFacingText(result.data, 'notes'));
  return problems;
}
