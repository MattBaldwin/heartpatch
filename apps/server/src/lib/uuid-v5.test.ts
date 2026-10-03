import { describe, expect, it } from 'vitest';
import { uuidV5 } from './uuid-v5.js';

/** RFC 9562's DNS namespace. */
const DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

describe('uuidV5', () => {
  it('matches the known vector', () => {
    expect(uuidV5('www.example.com', DNS)).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('is the same for the same name and different for another', () => {
    const a = uuidV5('11111111-1111-4111-8111-111111111111', DNS);
    expect(uuidV5('11111111-1111-4111-8111-111111111111', DNS)).toBe(a);
    expect(uuidV5('22222222-2222-4222-8222-222222222222', DNS)).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('refuses a namespace that is not a uuid', () => {
    expect(() => uuidV5('x', 'nope')).toThrow();
  });
});
