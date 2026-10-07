import { describe, expect, it } from 'vitest';
import { readBuildInfo, type BuildSource } from './build-info.js';

const now = new Date('2026-10-06T23:30:00-07:00'); // already the 7th in UTC
const sha = 'cb04682f1e2d3c4b5a69788796a5b4c3d2e1f001';

function source(overrides: Partial<BuildSource> = {}): BuildSource {
  return {
    env: {},
    git: (args) => (args[0] === 'rev-list' ? '214' : sha),
    now,
    ...overrides,
  };
}

describe('readBuildInfo (#198)', () => {
  it('reads the commit count and short sha from git, with the UTC date', () => {
    expect(readBuildInfo(source())).toEqual({
      number: 214,
      commit: 'cb04682',
      date: '2026-10-07',
    });
  });

  it("prefers the deploy's build args (the image has no .git)", () => {
    const git = () => {
      throw new Error('git must not run');
    };
    expect(readBuildInfo(source({ env: { APP_BUILD: '215', APP_COMMIT: sha }, git }))).toEqual({
      number: 215,
      commit: 'cb04682',
      date: '2026-10-07',
    });
  });

  it('fails the build on a half-set or bad build arg', () => {
    expect(() => readBuildInfo(source({ env: { APP_BUILD: '215' } }))).toThrow(/not a build/);
    expect(() => readBuildInfo(source({ env: { APP_BUILD: 'x', APP_COMMIT: sha } }))).toThrow();
    expect(() => readBuildInfo(source({ env: { APP_BUILD: '1', APP_COMMIT: 'main' } }))).toThrow();
  });

  it('is null without git, so the client says v0.dev', () => {
    expect(readBuildInfo(source({ git: () => null }))).toBeNull();
    expect(readBuildInfo(source({ git: () => 'fatal: not a git repository' }))).toBeNull();
  });
});
