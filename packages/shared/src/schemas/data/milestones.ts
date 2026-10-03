import { z } from 'zod';
import { GAME_EVENTS, GameEventTypeSchema } from '../events.js';
import type { ClothingItem } from './clothing.js';
import { ContentIdSchema, DescriptionSchema, DisplayNameSchema } from './common.js';
import { checkRef, formatDataIssues, type Path, type Report } from './issues.js';
import { TutorialPredicateSchema } from './tutorial.js';

// Keeper milestones (design doc §24; issue #44): long-term goals that award
// signature clothing, Patch Coins and titles. Account-level (DECISIONS F).
// A track is one counter with tiers along it ("Claim 10 / 50 / 150 tiles").
// Tracks are data: a new one needs no engine change (CLAUDE.md rule 5).
// Secret tracks live in `data/server/` (CLAUDE.md rule 6): the client sees
// "???" until one is earned. Ids are stored in `milestone_progress`,
// `milestone_rewards` and `keepers.title_id`, so never rename one.

/**
 * Progress is stored in hundredths of a step, so Gentle's share
 * (`rewardPercent`, DECISIONS "Territory (#15)") can count half a tile
 * without rounding a kid's progress away. Thresholds are whole steps.
 */
export const MILESTONE_UNIT = 100;

/** Dot path into an event's internal payload, as the tutorial's predicates use. */
const FieldPathSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)*$/);

/** One kind of game event that moves a track along. */
export const MilestoneSourceSchema = z.strictObject({
  eventType: GameEventTypeSchema,
  /** Every predicate must hold on the event's internal payload. */
  where: z.array(TutorialPredicateSchema),
  /** The payload field naming whose progress it is (`userId`, `defenderUserId`). */
  player: FieldPathSchema,
  /**
   * Counts how many different values this field has had (Collector: kinds of
   * squishy) instead of how many events.
   */
  distinct: FieldPathSchema.optional(),
  /** Scales each event by this payload percent (Gentle's `rewardPercent` on `tile.captured`). */
  scaleBy: FieldPathSchema.optional(),
});
export type MilestoneSource = z.infer<typeof MilestoneSourceSchema>;

/** Where a track's progress comes from. */
export const MilestoneProgressSchema = z.discriminatedUnion('from', [
  /** Game events on patches (decision F: only patches with enough players). */
  z.strictObject({ from: z.literal('events'), sources: z.array(MilestoneSourceSchema).min(1) }),
  /**
   * Finishing the tutorial once (`users.tutorial_completed_at`, DECISIONS "The
   * First Patch (#24)"): no event, so it's read from the account.
   */
  z.strictObject({ from: z.literal('tutorial-completed') }),
]);
export type MilestoneProgress = z.infer<typeof MilestoneProgressSchema>;

/** A title shown on the profile card (design doc §24). */
export const MilestoneTitleSchema = z.strictObject({
  /** Stored in `keepers.title_id` when worn. Unique across every track. */
  id: ContentIdSchema,
  name: DisplayNameSchema,
});
export type MilestoneTitle = z.infer<typeof MilestoneTitleSchema>;

export const MilestoneTierSchema = z.strictObject({
  /** Whole steps of progress to earn it; each tier needs more than the last. */
  threshold: z.number().int().min(1),
  /** What to do, for the Milestones screen ("Claim 10 tiles"). */
  goal: DescriptionSchema,
  title: MilestoneTitleSchema,
  /** Patch Coins (#45), paid with `creditCoins` (no daily cap). */
  coins: z.number().int().min(0),
  /** A signature piece (`sources: ['milestone']`, account-bound). */
  clothing: ContentIdSchema.optional(),
});
export type MilestoneTier = z.infer<typeof MilestoneTierSchema>;

export const MilestoneTrackSchema = z.strictObject({
  id: ContentIdSchema,
  name: DisplayNameSchema,
  /** Hidden ("???") until earned; only in the server's data. */
  secret: z.boolean(),
  /** Counts only while this season is on, by the patch's local date (design doc §15). */
  season: ContentIdSchema.optional(),
  progress: MilestoneProgressSchema,
  tiers: z.array(MilestoneTierSchema).min(1).max(5),
});
export type MilestoneTrack = z.infer<typeof MilestoneTrackSchema>;

/** Rules for counting (`// TUNE:` where they're set). */
export const MilestoneRulesSchema = z.strictObject({
  /**
   * Active members a patch needs before play there counts (design doc §24
   * [DEFAULT: 2], decision F), so a solo second account can't farm them.
   */
  minMembers: z.number().int().min(1),
});
export type MilestoneRules = z.infer<typeof MilestoneRulesSchema>;

export interface MilestoneDataContext {
  clothing: readonly ClothingItem[];
  seasons: readonly string[];
}

/**
 * Validates every milestone track, public and secret together (ids and
 * titles are unique across both), and returns readable problems, or `[]`.
 * Public tracks are never secret and secret ones always are, so a secret
 * can't ship to the client by mistake.
 */
export function checkMilestoneData(
  input: { public: unknown; secret: unknown },
  context: MilestoneDataContext,
): string[] {
  const clothing = new Map(context.clothing.map((c) => [c.id, c]));
  const seasons = new Set(context.seasons);
  const schema = z
    .strictObject({
      public: z.array(MilestoneTrackSchema),
      secret: z.array(MilestoneTrackSchema),
    })
    .superRefine((data, ctx) => {
      const report: Report = (path, message) => {
        ctx.addIssue({ code: 'custom', path, message });
      };
      const trackIds = new Set<string>();
      const titleIds = new Set<string>();
      for (const side of ['public', 'secret'] as const) {
        data[side].forEach((track, i) => {
          const at = (...rest: Path): Path => [side, i, ...rest];
          if (trackIds.has(track.id)) report(at('id'), `"${track.id}" is listed twice`);
          trackIds.add(track.id);
          if (track.secret !== (side === 'secret')) {
            report(at('secret'), 'secret tracks live in the server data, and only they do');
          }
          checkRef(seasons, 'season', track.season, at('season'), report);
          if (track.progress.from === 'events') {
            const { sources } = track.progress;
            sources.forEach((source, j) => {
              checkSource(source, at('progress', 'sources', j));
            });
            if (sources.some((s) => s.distinct) && sources.length > 1) {
              report(at('progress', 'sources'), 'a track counting kinds of things has one source');
            }
          }
          track.tiers.forEach((tier, t) => {
            const previous = track.tiers[t - 1];
            if (previous && tier.threshold <= previous.threshold) {
              report(at('tiers', t, 'threshold'), 'each tier needs more than the one before');
            }
            if (titleIds.has(tier.title.id)) {
              report(at('tiers', t, 'title', 'id'), `"${tier.title.id}" is listed twice`);
            }
            titleIds.add(tier.title.id);
            if (tier.clothing !== undefined) {
              const item = clothing.get(tier.clothing);
              if (!item) report(at('tiers', t, 'clothing'), `unknown clothing "${tier.clothing}"`);
              else if (!item.sources.includes('milestone') || item.tradable) {
                report(
                  at('tiers', t, 'clothing'),
                  'milestone pieces are account-bound milestone items',
                );
              }
            }
          });
        });
      }

      function checkSource(source: MilestoneSource, path: Path): void {
        const shape = GAME_EVENTS[source.eventType].internal;
        const fields = [
          source.player,
          ...(source.distinct ? [source.distinct] : []),
          ...(source.scaleBy ? [source.scaleBy] : []),
          ...source.where.map((p) => p.field),
        ];
        for (const field of fields) {
          const top = field.split('.')[0] ?? '';
          if (!(shape instanceof z.ZodObject) || !(top in shape.shape)) {
            report(path, `"${source.eventType}" has no "${top}"`);
          }
        }
      }
    });
  const result = schema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}
