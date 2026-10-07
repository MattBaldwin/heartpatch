import { z } from 'zod';

/**
 * `changelog.json` (#220): "What's new", built from `changes/*.md`
 * (apps/client/tooling/changelog). `build` is the commit count at the commit
 * that added the entry (the version line's number, #198); null means "Coming
 * next" (built without git history).
 */
export const ChangeAreaSchema = z.enum([
  'battles',
  'land',
  'home',
  'squishies',
  'account',
  'other',
]);
export type ChangeAreaId = z.infer<typeof ChangeAreaSchema>;

export const ChangeEntrySchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  area: ChangeAreaSchema,
  body: z.string().min(1),
  tryIt: z.string().min(1).nullable(),
  build: z.number().int().positive().nullable(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});
export type ChangeEntryView = z.infer<typeof ChangeEntrySchema>;

export const ChangelogSchema = z.object({ entries: z.array(ChangeEntrySchema) });
export type Changelog = z.infer<typeof ChangelogSchema>;
