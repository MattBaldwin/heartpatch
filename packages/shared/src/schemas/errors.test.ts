import { describe, expect, it } from 'vitest';
import { ApiErrorSchema, DEFAULT_ERROR_MESSAGES, ErrorCodeSchema } from './errors.js';

describe('error contract', () => {
  it('has a kid-readable default message for every code', () => {
    for (const code of ErrorCodeSchema.options) {
      expect(DEFAULT_ERROR_MESSAGES[code].length).toBeGreaterThan(0);
    }
  });

  it('accepts a well-formed error body', () => {
    const body = { error: { code: 'NOT_FOUND', message: 'Not here!' } };
    expect(ApiErrorSchema.parse(body)).toEqual(body);
  });

  it('rejects unknown error codes', () => {
    const result = ApiErrorSchema.safeParse({ error: { code: 'NOPE', message: 'x' } });
    expect(result.success).toBe(false);
  });
});
