import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The music's instrument notes (#664, `src/audio/music-samples.ts`): one
// mono AAC file, about 1.5 MB at most, since it loads after the first tap on
// every first visit.
const FILE = fileURLToPath(new URL('../../src/audio/samples/music-notes.m4a', import.meta.url));

describe('music instrument notes (#664)', () => {
  it('stay in one small file', () => {
    expect(statSync(FILE).size).toBeLessThan(1.5 * 1024 * 1024);
  });
});
