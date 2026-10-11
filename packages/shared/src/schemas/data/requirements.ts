import { z } from 'zod';
import { MoodIdSchema } from './care.js';
import { ContentIdSchema } from './common.js';

/*
 * Requirements for anything that levels up by "getting better" (#381 plan
 * §8): the Keeper's house now, the Heart Seed (#221) next. One discriminated
 * union, so a new kind is data plus one `case` in `evaluateRequirements`.
 * Every kind is meant to be seen (kids must know what to do next), so the
 * data is public. Secret conditions (Easter eggs) never join this union
 * (CLAUDE.md rule 6).
 */

const count = z.number().int().min(1);

export const RequirementSchema = z.discriminatedUnion('kind', [
  // The six #221 reads first (Heart Seed levels).
  z.strictObject({
    kind: z.literal('ownedTilesWithin'),
    radius: z.number().int().min(1),
    count,
  }),
  z.strictObject({
    kind: z.literal('milestonesReached'),
    trackId: ContentIdSchema.optional(),
    count,
  }),
  z.strictObject({ kind: z.literal('squishiesBefriended'), count }),
  z.strictObject({
    kind: z.literal('buildingsBuilt'),
    /** Only buildings of this kind (`habitat`, `hearthfire`, …). */
    buildingKind: ContentIdSchema.optional(),
    /** Only this building (`cozy-meadow`). */
    buildingId: ContentIdSchema.optional(),
    count,
  }),
  z.strictObject({ kind: z.literal('tilesFullyExplored'), count }),
  z.strictObject({ kind: z.literal('speciesSeen'), count }),
  // Your home base.
  z.strictObject({ kind: z.literal('habitatKinds'), count }),
  z.strictObject({ kind: z.literal('litFires'), count }),
  z.strictObject({ kind: z.literal('decorations'), count }),
  // Your residents.
  z.strictObject({ kind: z.literal('residentsContent'), mood: MoodIdSchema, count }),
  z.strictObject({ kind: z.literal('residentsLevel'), level: z.number().int().min(1), count }),
  z.strictObject({ kind: z.literal('residentsEvolved'), count }),
  // Your patch-mates.
  z.strictObject({
    kind: z.literal('tradesCompleted'),
    /** Which completed offers count; both when left out. */
    tradeKinds: z
      .array(z.enum(['trade', 'gift']))
      .min(1)
      .optional(),
    count,
  }),
  z.strictObject({ kind: z.literal('patchMatesTradedWith'), count }),
  z.strictObject({ kind: z.literal('postsUsed'), count }),
  // Your land.
  z.strictObject({ kind: z.literal('tilesTended'), count }),
  z.strictObject({ kind: z.literal('homesteads'), count }),
  // The Heart Seed caps the house (owner decision 2026-10-11).
  z.strictObject({ kind: z.literal('heartSeedLevel'), level: z.number().int().min(1) }),
]);
export type Requirement = z.infer<typeof RequirementSchema>;
export type RequirementKind = Requirement['kind'];

/** Every kind, for `RequirementProgress.kind` (the client switches on it). */
export const RequirementKindSchema = z.enum(
  RequirementSchema.options.map((o) => o.shape.kind.value) as [
    RequirementKind,
    ...RequirementKind[],
  ],
);

/**
 * Where a row shows on a progress screen: the four kinds of "getting
 * better" (DECISIONS #381), the Seed cap row, and `adventure` for the
 * exploring and collecting reads the Heart Seed (#221) uses.
 */
export const RequirementGroupSchema = z.enum([
  'seed',
  'home',
  'residents',
  'patch-mates',
  'land',
  'adventure',
]);
export type RequirementGroup = z.infer<typeof RequirementGroupSchema>;

/**
 * One requirement as the server reports it: the kid-readable `line` and
 * `hint` are built on the server (`requirementLine`), so the client never
 * works out progress (CLAUDE.md rule 1). `have`/`need` drive the bar.
 */
export const RequirementProgressSchema = z.strictObject({
  id: z.string().min(1),
  kind: RequirementKindSchema,
  group: RequirementGroupSchema,
  line: z.string().min(1),
  have: z.number().int().min(0),
  need: z.number().int().min(1),
  done: z.boolean(),
  hint: z.string().min(1).nullable(),
});
export type RequirementProgress = z.infer<typeof RequirementProgressSchema>;
