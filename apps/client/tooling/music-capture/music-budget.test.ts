import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The music's instrument notes (#664, `src/audio/music-samples.ts`): small
// mono AAC files, about 1.5 MB at most in all, since they load after the
// first tap on every first visit.
const FOLDER = fileURLToPath(new URL('../../src/audio/samples/music', import.meta.url));

describe('music instrument notes (#664)', () => {
  it('stay small, AAC and named instrument-note', () => {
    const files = readdirSync(FOLDER);
    expect(files.length).toBe(44);
    let bytes = 0;
    for (const file of files) {
      expect(file).toMatch(/^[a-z]+-[a-z0-9]+\.m4a$/);
      bytes += statSync(join(FOLDER, file)).size;
    }
    expect(bytes).toBeLessThan(1.5 * 1024 * 1024);
  });
});
