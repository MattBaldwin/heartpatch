import { describe, expect, it } from 'vitest';
import { hashSecret, verifyAgainstDummy, verifySecret } from './secrets.js';

// The real Argon2id hashing (tech spec §9). The route tests swap it for a
// cheap stand-in (tests/fake-secrets.ts), so what it does is pinned here.
describe('secrets', () => {
  it('hashes with Argon2id and verifies only the right secret', async () => {
    const hash = await hashSecret('squishy-secret');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('squishy-secret');
    expect(await verifySecret(hash, 'squishy-secret')).toBe(true);
    expect(await verifySecret(hash, 'squishy-secre')).toBe(false);
    // Two hashes of one secret differ (a fresh salt each time).
    expect(await hashSecret('squishy-secret')).not.toBe(hash);
  });

  it('treats a stored value that is not an Argon2 hash as a wrong secret', async () => {
    expect(await verifySecret('not-a-hash', 'not-a-hash')).toBe(false);
    expect(await verifySecret('', '')).toBe(false);
  });

  it('never accepts a secret against the dummy hash', async () => {
    expect(await verifyAgainstDummy('anything')).toBe(false);
  });
});
