import { z } from 'zod';
import { ContentIdSchema } from './data/common.js';
import { ItemCountsSchema } from './inventory.js';

// Clockwork Isle research (#874): one node at a time per player per patch,
// on their Research Bench. What I know and what's going are mine alone;
// the patch hears only `research.done`.

/** `POST /maps/:mapId/research`: start a node on one of my benches. */
export const StartResearchRequestSchema = z.strictObject({
  buildingId: z.uuid(),
  nodeId: ContentIdSchema,
});
export type StartResearchRequest = z.infer<typeof StartResearchRequestSchema>;

/** The node going on my bench now: when it started and when it's ready. */
export const ResearchGoingSchema = z.object({
  nodeId: ContentIdSchema,
  startedAt: z.iso.datetime(),
  readyAt: z.iso.datetime(),
});
export type ResearchGoing = z.infer<typeof ResearchGoingSchema>;

/**
 * `GET /maps/:mapId/research`: the nodes I know on this patch and the one
 * going (null: none), with the server's clock for the countdown. Only ever
 * my own (`NOT_FOUND` on any patch but a Clockwork Isle).
 */
export const ResearchViewSchema = z.object({
  known: z.array(ContentIdSchema),
  going: ResearchGoingSchema.nullable(),
  serverTime: z.iso.datetime(),
});
export type ResearchView = z.infer<typeof ResearchViewSchema>;

/** A research command's answer: my research now and my bag. */
export const ResearchResponseSchema = z.object({
  research: ResearchViewSchema,
  items: ItemCountsSchema,
});
export type ResearchResponse = z.infer<typeof ResearchResponseSchema>;
