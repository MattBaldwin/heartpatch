import { describe, expect, it } from 'vitest';
import { loadConfig, loadServerConfig } from './config.js';

const DATABASE_URL = 'postgres://heartpatch:heartpatch@localhost:5432/heartpatch';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig({ DATABASE_URL });
    expect(config.PORT).toBe(3000);
    expect(config.NODE_ENV).toBe('production');
    expect(config.TRUST_PROXY).toBe(false);
  });

  it('refuses invalid values and lists every problem', () => {
    expect(() => loadConfig({ PORT: 'abc', PUBLIC_ORIGIN: 'not a url' })).toThrow(
      /PORT[\s\S]*PUBLIC_ORIGIN/,
    );
  });

  it('requires a postgres DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: 'mysql://localhost/heartpatch' })).toThrow(
      /DATABASE_URL/,
    );
    expect(loadConfig({ DATABASE_URL: 'postgresql://localhost/heartpatch' }).DATABASE_URL).toBe(
      'postgresql://localhost/heartpatch',
    );
    expect(loadConfig({ DATABASE_URL }).DATABASE_URL).toBe(DATABASE_URL);
  });

  it('keeps the signup code optional for tools like db/cli.ts', () => {
    expect(loadConfig({ DATABASE_URL }).HP_SIGNUP_CODE).toBeUndefined();
  });
});

describe('loadServerConfig', () => {
  it('refuses to start in production without a signup code', () => {
    expect(() => loadServerConfig({ DATABASE_URL })).toThrow(/HP_SIGNUP_CODE/);
    expect(loadServerConfig({ DATABASE_URL, HP_SIGNUP_CODE: 'family-code' }).HP_SIGNUP_CODE).toBe(
      'family-code',
    );
  });

  it('allows a missing signup code outside production (signups are closed)', () => {
    expect(loadServerConfig({ DATABASE_URL, NODE_ENV: 'development' }).HP_SIGNUP_CODE).toBe(
      undefined,
    );
  });

  it('rejects a signup code that is too short to be secret', () => {
    expect(() => loadServerConfig({ DATABASE_URL, HP_SIGNUP_CODE: 'short' })).toThrow(
      /HP_SIGNUP_CODE/,
    );
  });
});
