import { z } from 'zod';

/**
 * Query-string values always arrive as strings, and a repeated key arrives as
 * an array only when it appears more than once. Use these helpers for query
 * params instead of `z.coerce`, which turns `?n=` into 0.
 */

/** An integer query param. Rejects empty strings, decimals and junk. */
export function queryInt(options: { min?: number; max?: number } = {}) {
  let num = z.number().int();
  if (options.min !== undefined) num = num.min(options.min);
  if (options.max !== undefined) num = num.max(options.max);
  return z
    .string()
    .regex(/^-?\d+$/, 'Expected a whole number')
    .transform(Number)
    .pipe(num);
}

/** A boolean query param: `true`/`false` or `1`/`0`. */
export function queryBool() {
  return z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
}

/** A list query param: `?tag=a` and `?tag=a&tag=b` both parse to arrays. */
export function queryArray<T extends z.ZodType>(item: T) {
  return z.preprocess((v) => (typeof v === 'string' ? [v] : v), z.array(item));
}
