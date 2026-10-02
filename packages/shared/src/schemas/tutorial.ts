import { z } from 'zod';
import { ContentIdSchema } from './data/common.js';

// Tutorial API schemas (design doc §26; tech spec §7). The client looks a
// step id up in `TUTORIAL_STEPS` for Sprout's lines and highlight target.

export const TutorialStatusSchema = z.enum(['not-started', 'in-progress', 'completed']);
export type TutorialStatus = z.infer<typeof TutorialStatusSchema>;

/** Where the player is in the tutorial (`GET /api/v1/tutorial`). */
export const TutorialStateSchema = z.object({
  /**
   * `in-progress` while a run is going (including a replay); otherwise
   * `completed` once finished at least once, else `not-started`.
   */
  status: TutorialStatusSchema,
  /** The current step while a run is going; null otherwise. */
  stepId: ContentIdSchema.nullable(),
  /** The run's tutorial map while a run is going; null otherwise. */
  mapId: z.uuid().nullable(),
  /** First completion. Set = the player may skip (design doc §26). */
  completedAt: z.iso.datetime().nullable(),
  /** `HP_TUTORIAL_REQUIRED`: new players must finish it before multiplayer (decision A). */
  required: z.boolean(),
});
export type TutorialState = z.infer<typeof TutorialStateSchema>;

export const TutorialResponseSchema = z.object({ tutorial: TutorialStateSchema });
export type TutorialResponse = z.infer<typeof TutorialResponseSchema>;

/** The player read a talk-only step (`POST /api/v1/tutorial/acknowledge`). */
export const AcknowledgeStepRequestSchema = z.strictObject({ stepId: ContentIdSchema });
export type AcknowledgeStepRequest = z.infer<typeof AcknowledgeStepRequestSchema>;
