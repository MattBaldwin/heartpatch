import { describe, expect, it } from 'vitest';
import { BuildInfoSchema, HealthResponseSchema } from '../schemas/health.js';
import { APP_MAJOR, formatAppVersion } from './app-version.js';

describe('formatAppVersion (#198)', () => {
  it('is pre-v1 until the owner publishes the full game', () => {
    expect(APP_MAJOR).toBe(0);
  });

  it('shows the build number, short sha and UTC date', () => {
    const line = formatAppVersion({ number: 214, commit: 'cb04682', date: '2026-10-06' });
    expect(line).toBe('v0.214 · cb04682 · 2026-10-06');
    expect(line).toMatch(/^v0\.\d+ · [0-9a-f]{7} · \d{4}-\d{2}-\d{2}$/);
  });

  it('says dev for a build made without git', () => {
    expect(formatAppVersion(null)).toBe('v0.dev');
  });
});

describe('BuildInfoSchema', () => {
  it('takes only a positive build, a 7-digit hex sha and a date', () => {
    const ok = { number: 1, commit: '0123abc', date: '2026-10-06' };
    expect(BuildInfoSchema.safeParse(ok).success).toBe(true);
    expect(BuildInfoSchema.safeParse({ ...ok, number: 0 }).success).toBe(false);
    expect(BuildInfoSchema.safeParse({ ...ok, commit: '0123ABC' }).success).toBe(false);
    expect(BuildInfoSchema.safeParse({ ...ok, commit: '0123abcd' }).success).toBe(false);
    expect(BuildInfoSchema.safeParse({ ...ok, date: '6 Oct 2026' }).success).toBe(false);
  });

  it('lets the health reply say it has no build', () => {
    const health = { status: 'ok', version: 'dev', build: null, commit: null, uptimeSeconds: 1 };
    expect(HealthResponseSchema.safeParse(health).success).toBe(true);
  });

  it("reads an older server's reply, without them, as no build", () => {
    expect(HealthResponseSchema.parse({ status: 'ok', version: 'dev', uptimeSeconds: 1 })).toEqual({
      status: 'ok',
      version: 'dev',
      build: null,
      commit: null,
      uptimeSeconds: 1,
    });
  });
});
