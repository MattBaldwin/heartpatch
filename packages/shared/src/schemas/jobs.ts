import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { ContentIdSchema } from './data/common.js';
import { ItemCountsSchema } from './inventory.js';
import { OwnedSquishySchema } from './squishies.js';

// Squishy jobs (owner decisions 2026-10-04): one job each, the battle team,
// and squishy gatherers. Routes: `GET /maps/:mapId/jobs`,
// `POST /maps/:mapId/squishies/:squishyId/job`, `POST /maps/:mapId/team` and
// `POST /maps/:mapId/work/collect` (send an `Idempotency-Key` on the last three).

export const SquishyJobIdSchema = z.enum(['team', 'guard', 'gatherer', 'training', 'resting']);

const TileSchema = z.object({ q: HexSchema.shape.q, r: HexSchema.shape.r });

/** A gatherer at work: where, what, and what's waiting to be collected. */
export const WorkStatusSchema = z.object({
  ...TileSchema.shape,
  resource: ContentIdSchema,
  /** A node, or plain owned land. */
  from: z.enum(['node', 'land']),
  /** Seconds per cycle for this squishy (its match included). */
  cycleSeconds: z.number().int().min(1),
  /** Its speed as a whole percent (100, or quicker when it matches). */
  speedPercent: z.number().int().min(100),
  /** Finished cycles waiting. */
  readyCycles: z.number().int().min(0),
  /** What collecting now would give. */
  ready: ItemCountsSchema,
  /** When the next cycle finishes; null while it's full and waiting. */
  nextReadyAt: z.iso.datetime().nullable(),
  full: z.boolean(),
  /** A lit Hearthfire keeps this tile safe tonight (else the Hollow Man may visit). */
  firelit: z.boolean(),
});
export type WorkStatus = z.infer<typeof WorkStatusSchema>;

/** A squishy practicing at the Training Grounds (owner decision 2026-10-06). */
export const TrainingStatusSchema = z.object({
  /** The Training Grounds building row it practices at. */
  buildingId: z.uuid(),
  xpPerHour: z.number().int().min(1),
  /** XP waiting to land at the next settle. */
  xpReady: z.number().int().min(0),
  /** A whole `training.maxHours` waited: it earns nothing more until it lands. */
  full: z.boolean(),
});
export type TrainingStatus = z.infer<typeof TrainingStatusSchema>;

/** One of my squishies on the job board. */
export const JobSquishySchema = z.object({
  squishy: OwnedSquishySchema,
  job: SquishyJobIdSchema,
  /** Its place on the team (0 first), or null. */
  teamSlot: z.number().int().min(0).nullable(),
  /** The tile it stands watch on, or null. */
  post: TileSchema.nullable(),
  /** The habitat it lives in, or null (it waits by the Heart Seed). */
  habitatId: z.uuid().nullable(),
  work: WorkStatusSchema.nullable(),
  training: TrainingStatusSchema.nullable(),
  /**
   * It has won its full-XP battles for today (#201, `battleXpFalloff`), so
   * wins pay less until then: the patch's next local midnight. Null while
   * wins still pay in full.
   */
  fullXpResetAt: z.iso.datetime().nullable(),
});
export type JobSquishy = z.infer<typeof JobSquishySchema>;

/** A tile of mine a gatherer could work. */
export const WorkSpotSchema = z.object({
  ...TileSchema.shape,
  terrain: ContentIdSchema,
  resource: ContentIdSchema,
  from: z.enum(['node', 'land']),
  /** Per cycle, before seasonal extras. */
  quantity: z.number().int().min(1),
  /** The Keeper-equivalent time; each squishy's own cycle depends on its match. */
  seconds: z.number().int().min(1),
  /** Its resource is in season today (Pumpkins only around Halloween). */
  inSeason: z.boolean(),
  /** The squishy working it now, or null. */
  workerId: z.uuid().nullable(),
  /** A lit Hearthfire keeps it safe tonight. */
  firelit: z.boolean(),
});
export type WorkSpot = z.infer<typeof WorkSpotSchema>;

/** `GET /maps/:mapId/jobs` and the reply to every job command. */
export const JobsViewSchema = z.object({
  squishies: z.array(JobSquishySchema),
  /**
   * What to call each of my squishies (squishy id → its nickname, else its
   * species' name). Only mine, so a secret species' name only reaches the
   * player who has one (CLAUDE.md rule 6), as the care list does.
   */
  names: z.record(z.uuid(), z.string()),
  /** My team in slot order (squishy ids). Empty: battles take my strongest resting squishies. */
  team: z.array(z.uuid()),
  spots: z.array(WorkSpotSchema),
  /** My Training Grounds and how full it is, or null if I haven't built one. */
  trainingGrounds: z
    .object({
      id: z.uuid(),
      capacity: z.number().int().min(1),
      used: z.number().int().min(0),
    })
    .nullable(),
  rules: z.object({
    teamSize: z.number().int().min(1),
    maxStoredCycles: z.number().int().min(1),
  }),
  now: z.iso.datetime(),
});
export type JobsView = z.infer<typeof JobsViewSchema>;

/** `POST /maps/:mapId/squishies/:squishyId/job`: its new job (guards are posted from the tile panel). */
export const SetJobRequestSchema = z.discriminatedUnion('job', [
  z.strictObject({ job: z.literal('resting') }),
  z.strictObject({ job: z.literal('team') }),
  z.strictObject({ job: z.literal('gatherer'), ...TileSchema.shape }),
  /** At my Training Grounds (one per home base). */
  z.strictObject({ job: z.literal('training') }),
]);
export type SetJobRequest = z.infer<typeof SetJobRequestSchema>;

/** `POST /maps/:mapId/team`: the whole team in slot order (empty clears it). */
export const SetTeamRequestSchema = z.strictObject({
  squishyIds: z.array(z.uuid()).max(6),
});
export type SetTeamRequest = z.infer<typeof SetTeamRequestSchema>;

/** `POST /maps/:mapId/work/collect`: everything my gatherers had ready. */
export const CollectWorkResponseSchema = z.object({
  granted: ItemCountsSchema,
  items: ItemCountsSchema,
  jobs: JobsViewSchema,
});
export type CollectWorkResponse = z.infer<typeof CollectWorkResponseSchema>;
