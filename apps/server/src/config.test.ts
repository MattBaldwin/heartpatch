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

  it('leaves the tutorial gate off unless set to true', () => {
    expect(loadConfig({ DATABASE_URL }).HP_TUTORIAL_REQUIRED).toBe(false);
    expect(loadConfig({ DATABASE_URL, HP_TUTORIAL_REQUIRED: 'false' }).HP_TUTORIAL_REQUIRED).toBe(
      false,
    );
    expect(loadConfig({ DATABASE_URL, HP_TUTORIAL_REQUIRED: 'true' }).HP_TUTORIAL_REQUIRED).toBe(
      true,
    );
    expect(() => loadConfig({ DATABASE_URL, HP_TUTORIAL_REQUIRED: 'yes' })).toThrow(
      /HP_TUTORIAL_REQUIRED/,
    );
  });

  it('keeps the Keeper gate on unless set to false', () => {
    expect(loadConfig({ DATABASE_URL }).HP_KEEPER_REQUIRED).toBe(true);
    expect(loadConfig({ DATABASE_URL, HP_KEEPER_REQUIRED: 'false' }).HP_KEEPER_REQUIRED).toBe(
      false,
    );
    expect(() => loadConfig({ DATABASE_URL, HP_KEEPER_REQUIRED: 'no' })).toThrow(
      /HP_KEEPER_REQUIRED/,
    );
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

  it('accepts HP_DEV_MAP_CREATE_LIMIT_PER_IP outside production only', () => {
    expect(
      loadServerConfig({
        DATABASE_URL,
        NODE_ENV: 'development',
        HP_DEV_MAP_CREATE_LIMIT_PER_IP: '200',
      }).HP_DEV_MAP_CREATE_LIMIT_PER_IP,
    ).toBe(200);
    expect(
      loadServerConfig({ DATABASE_URL, NODE_ENV: 'test' }).HP_DEV_MAP_CREATE_LIMIT_PER_IP,
    ).toBe(undefined);
    expect(() =>
      loadServerConfig({
        DATABASE_URL,
        HP_SIGNUP_CODE: 'family-code',
        HP_DEV_MAP_CREATE_LIMIT_PER_IP: '200',
      }),
    ).toThrow(/HP_DEV_MAP_CREATE_LIMIT_PER_IP/);
    expect(() => loadConfig({ DATABASE_URL, HP_DEV_MAP_CREATE_LIMIT_PER_IP: '0' })).toThrow(
      /HP_DEV_MAP_CREATE_LIMIT_PER_IP/,
    );
  });

  it('accepts HP_DEV_SIGNUP_LIMIT_PER_IP outside production only', () => {
    expect(
      loadServerConfig({ DATABASE_URL, NODE_ENV: 'development', HP_DEV_SIGNUP_LIMIT_PER_IP: '200' })
        .HP_DEV_SIGNUP_LIMIT_PER_IP,
    ).toBe(200);
    expect(loadServerConfig({ DATABASE_URL, NODE_ENV: 'test' }).HP_DEV_SIGNUP_LIMIT_PER_IP).toBe(
      undefined,
    );
    expect(() =>
      loadServerConfig({
        DATABASE_URL,
        HP_SIGNUP_CODE: 'family-code',
        HP_DEV_SIGNUP_LIMIT_PER_IP: '200',
      }),
    ).toThrow(/HP_DEV_SIGNUP_LIMIT_PER_IP/);
    expect(() => loadConfig({ DATABASE_URL, HP_DEV_SIGNUP_LIMIT_PER_IP: '0' })).toThrow(
      /HP_DEV_SIGNUP_LIMIT_PER_IP/,
    );
  });

  it('accepts HP_DEV_SQUISHY_GRANTS outside production only', () => {
    expect(
      loadServerConfig({ DATABASE_URL, NODE_ENV: 'development', HP_DEV_SQUISHY_GRANTS: 'true' })
        .HP_DEV_SQUISHY_GRANTS,
    ).toBe(true);
    expect(loadServerConfig({ DATABASE_URL, NODE_ENV: 'test' }).HP_DEV_SQUISHY_GRANTS).toBe(false);
    expect(() =>
      loadServerConfig({
        DATABASE_URL,
        HP_SIGNUP_CODE: 'family-code',
        HP_DEV_SQUISHY_GRANTS: 'true',
      }),
    ).toThrow(/HP_DEV_SQUISHY_GRANTS/);
    // Off is always fine, in production too.
    expect(
      loadServerConfig({
        DATABASE_URL,
        HP_SIGNUP_CODE: 'family-code',
        HP_DEV_SQUISHY_GRANTS: 'false',
      }).HP_DEV_SQUISHY_GRANTS,
    ).toBe(false);
  });

  it('accepts HP_DEV_DROP_CHANCE outside production only', () => {
    expect(
      loadServerConfig({ DATABASE_URL, NODE_ENV: 'test', HP_DEV_DROP_CHANCE: '100' })
        .HP_DEV_DROP_CHANCE,
    ).toBe(100);
    expect(loadServerConfig({ DATABASE_URL, NODE_ENV: 'test' }).HP_DEV_DROP_CHANCE).toBeUndefined();
    expect(() =>
      loadServerConfig({ DATABASE_URL, HP_SIGNUP_CODE: 'family-code', HP_DEV_DROP_CHANCE: '5' }),
    ).toThrow(/HP_DEV_DROP_CHANCE/);
    expect(() => loadConfig({ DATABASE_URL, HP_DEV_DROP_CHANCE: '101' })).toThrow(
      /HP_DEV_DROP_CHANCE/,
    );
  });

  it('accepts HP_SEED_ALLOW_REMOTE=1 outside production only', () => {
    expect(loadConfig({ DATABASE_URL, NODE_ENV: 'development' }).HP_SEED_ALLOW_REMOTE).toBe(false);
    expect(
      loadConfig({ DATABASE_URL, NODE_ENV: 'development', HP_SEED_ALLOW_REMOTE: '1' })
        .HP_SEED_ALLOW_REMOTE,
    ).toBe(true);
    expect(() =>
      loadServerConfig({ DATABASE_URL, HP_SIGNUP_CODE: 'family-code', HP_SEED_ALLOW_REMOTE: '1' }),
    ).toThrow(/HP_SEED_ALLOW_REMOTE/);
    expect(() => loadConfig({ DATABASE_URL, HP_SEED_ALLOW_REMOTE: 'true' })).toThrow(
      /HP_SEED_ALLOW_REMOTE/,
    );
  });

  it('accepts HP_DEV_NOW outside production only', () => {
    const at = '2026-12-20T20:59:00-05:00';
    expect(
      loadServerConfig({ DATABASE_URL, NODE_ENV: 'development', HP_DEV_NOW: at }).HP_DEV_NOW,
    ).toBe(at);
    expect(() =>
      loadServerConfig({ DATABASE_URL, HP_SIGNUP_CODE: 'family-code', HP_DEV_NOW: at }),
    ).toThrow(/HP_DEV_NOW/);
    expect(() => loadConfig({ DATABASE_URL, HP_DEV_NOW: 'next tuesday' })).toThrow(/HP_DEV_NOW/);
  });

  it('rejects a signup code that is too short to be secret', () => {
    expect(() => loadServerConfig({ DATABASE_URL, HP_SIGNUP_CODE: 'short' })).toThrow(
      /HP_SIGNUP_CODE/,
    );
  });
});
