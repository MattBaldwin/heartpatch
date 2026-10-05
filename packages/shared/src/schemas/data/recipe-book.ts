import { z } from 'zod';
import { findAvoidedWords } from '../../data/avoided-words.js';
import { ContentIdSchema } from './common.js';
import { formatDataIssues } from './issues.js';

/*
 * The recipe book (owner decision 2026-10-05, design doc §12): one page per
 * craft recipe and per home-buildable building. A page opens the first time
 * the account has collected every ingredient it needs; a few are open from
 * the start. Public data: hints only point at public gather, terrain and
 * season facts, never spawn tables or anything under data/server.
 */

/** `recipe:<recipeId>` or `building:<buildingId>`. */
export const RecipeBookPageKeySchema = z.string().refine(
  (key) => {
    const [kind, id, ...rest] = key.split(':');
    return (
      rest.length === 0 &&
      (kind === 'recipe' || kind === 'building') &&
      ContentIdSchema.safeParse(id).success
    );
  },
  { message: 'Expected a page key like "recipe:heart-charm" or "building:hearthfire"' },
);

/** Most words a sealed page's hint may use (style guide §2: short, kid-readable). */
export const SEALED_HINT_MAX_WORDS = 20;

/** What a sealed page says about where its missing ingredients turn up. */
export const SealedHintSchema = z.strictObject({
  page: RecipeBookPageKeySchema,
  line: z.string().trim().min(1).max(140),
});
export type SealedHint = z.infer<typeof SealedHintSchema>;

export const RecipeBookDataSchema = z.strictObject({
  /** Pages open from the very first session (what the tutorial needs to make). */
  alwaysOpen: z.array(RecipeBookPageKeySchema).min(1),
  /** One hint per page that can be sealed. */
  sealedHints: z.array(SealedHintSchema),
});
export type RecipeBookData = z.infer<typeof RecipeBookDataSchema>;

/**
 * Validates recipe book data against the book's real pages (`pageKeys`) and
 * returns readable problems, or `[]`: every key is a real page, always-open
 * pages need no hint, every other page has exactly one, and hints stay short
 * with no avoided words (style guide §9).
 */
export function checkRecipeBook(input: unknown, pageKeys: readonly string[]): string[] {
  const result = RecipeBookDataSchema.safeParse(input);
  if (!result.success) return formatDataIssues(input, result.error);
  const book = result.data;
  const pages = new Set(pageKeys);
  const open = new Set(book.alwaysOpen);
  const problems: string[] = [];
  for (const key of book.alwaysOpen) {
    if (!pages.has(key)) problems.push(`alwaysOpen: unknown page "${key}"`);
  }
  if (open.size !== book.alwaysOpen.length) problems.push('alwaysOpen: a page is listed twice');
  const hinted = new Set<string>();
  for (const { page, line } of book.sealedHints) {
    if (!pages.has(page)) problems.push(`sealedHints: unknown page "${page}"`);
    if (open.has(page)) problems.push(`sealedHints: "${page}" is always open, so it needs no hint`);
    if (hinted.has(page)) problems.push(`sealedHints: "${page}" has two hints`);
    hinted.add(page);
    const words = line.split(/\s+/).length;
    if (words > SEALED_HINT_MAX_WORDS) {
      problems.push(
        `sealedHints: "${page}" is ${String(words)} words (max ${String(SEALED_HINT_MAX_WORDS)})`,
      );
    }
    for (const word of findAvoidedWords(line)) {
      problems.push(`sealedHints: "${page}" uses the avoided word "${word}"`);
    }
  }
  for (const key of pageKeys) {
    if (!open.has(key) && !hinted.has(key)) problems.push(`sealedHints: "${key}" needs a hint`);
  }
  return problems;
}
