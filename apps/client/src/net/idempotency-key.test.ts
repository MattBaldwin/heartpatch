import { describe, expect, it } from 'vitest';
import { newIdempotencyKey } from './idempotency-key.js';

describe('newIdempotencyKey', () => {
  it('makes 32 hex characters that differ each time', () => {
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(50);
    for (const key of keys) expect(key).toMatch(/^[0-9a-f]{32}$/);
  });
});
