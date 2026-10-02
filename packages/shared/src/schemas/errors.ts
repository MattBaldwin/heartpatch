import { z } from 'zod';

/**
 * Every API error code the server can return. Clients switch on these, so
 * add new codes here rather than inventing strings in a module.
 */
export const ErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** Error response body: `{ error: { code, message } }` (tech spec §5). */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/**
 * Default kid-readable message per code (style guide §6). Modules may send a
 * more specific message, but never a raw technical one.
 */
export const DEFAULT_ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  BAD_REQUEST: "Hmm, that didn't quite work. Let's try again!",
  VALIDATION_FAILED: 'Something in there needs another look. Check it and try again!',
  UNAUTHENTICATED: 'Please log in to keep playing.',
  FORBIDDEN: "You can't do that here. Let's try something else!",
  NOT_FOUND: "We couldn't find that. Let's head back and try again.",
  CONFLICT: 'Something changed while you were busy. Please try again!',
  RATE_LIMITED: 'Whoa, slow down a little! Try again in a moment.',
  INTERNAL: 'Oops, something went wobbly on our side. Please try again!',
};
