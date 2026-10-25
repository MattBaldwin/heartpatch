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

  it('keeps the house switched off unless set (#381)', () => {
    expect(loadConfig({ DATABASE_URL }).HP_HOUSE).toBe('off');
    expect(loadConfig({ DATABASE_URL }).HP_HOUSE_TESTERS).toEqual([]);
    const testers = loadConfig({
      DATABASE_URL,
      HP_HOUSE: 'testers',
      HP_HOUSE_TESTERS: ' Matt, lee ,,',
    });
    expect(testers.HP_HOUSE).toBe('testers');
    expect(testers.HP_HOUSE_TESTERS).toEqual(['matt', 'lee']);
    expect(() => loadConfig({ DATABASE_URL, HP_HOUSE: 'yes' })).toThrow(/HP_HOUSE/);
  });

  it('keeps Wild Isle switched off unless set (#621)', () => {
    expect(loadConfig({ DATABASE_URL }).HP_WILD_ISLE).toBe('off');
    expect(loadConfig({ DATABASE_URL }).HP_WILD_ISLE_TESTERS).toEqual([]);
    const testers = loadConfig({
      DATABASE_URL,
      HP_WILD_ISLE: 'testers',
      HP_WILD_ISLE_TESTERS: ' Matt, lee ,,',
    });
    expect(testers.HP_WILD_ISLE).toBe('testers');
    expect(testers.HP_WILD_ISLE_TESTERS).toEqual(['matt', 'lee']);
    expect(() => loadConfig({ DATABASE_URL, HP_WILD_ISLE: 'yes' })).toThrow(/HP_WILD_ISLE/);
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

/** A production evolution salt for these tests only (#32). */
const SALT = 'test-only-evolution-salt';

describe('loadServerConfig', () => {
  it('refuses to start in production without a signup code', () => {
    expect(() => loadServerConfig({ DATABASE_URL })).toThrow(/HP_SIGNUP_CODE/);
    // Evolution rolls need their secret salt in production too (#32).
    expect(() => loadServerConfig({ DATABASE_URL, HP_SIGNUP_CODE: 'family-code' })).toThrow(
      /HP_EVOLUTION_SALT/,
    );
    expect(
      loadServerConfig({ DATABASE_URL, HP_SIGNUP_CODE: 'family-code', HP_EVOLUTION_SALT: SALT })
        .HP_SIGNUP_CODE,
    ).toBe('family-code');
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
        HP_EVOLUTION_SALT: SALT,
        HP_DEV_SQUISHY_GRANTS: 'false',
      }).HP_DEV_SQUISHY_GRANTS,
    ).toBe(false);
  });

  it('accepts the live-battle timings outside production only (#29)', () => {
    const config = loadServerConfig({
      DATABASE_URL,
      NODE_ENV: 'test',
      HP_DEV_LIVE_TURN_SECONDS: '6',
      HP_DEV_LIVE_GRACE_SECONDS: '4',
    });
    expect([config.HP_DEV_LIVE_TURN_SECONDS, config.HP_DEV_LIVE_GRACE_SECONDS]).toEqual([6, 4]);
    expect(() =>
      loadServerConfig({
        DATABASE_URL,
        HP_SIGNUP_CODE: 'family-code',
        HP_DEV_LIVE_TURN_SECONDS: '6',
      }),
    ).toThrow(/HP_DEV_LIVE_TURN_SECONDS/);
    expect(() =>
      loadServerConfig({
        DATABASE_URL,
        HP_SIGNUP_CODE: 'family-code',
        HP_DEV_LIVE_GRACE_SECONDS: '4',
      }),
    ).toThrow(/HP_DEV_LIVE_GRACE_SECONDS/);
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

  it('accepts HP_SEED_ALLOW_REMOTE outside production only', () => {
    expect(loadConfig({ DATABASE_URL, NODE_ENV: 'development' }).HP_SEED_ALLOW_REMOTE).toBe(false);
    expect(
      loadConfig({ DATABASE_URL, NODE_ENV: 'development', HP_SEED_ALLOW_REMOTE: 'true' })
        .HP_SEED_ALLOW_REMOTE,
    ).toBe(true);
    expect(() =>
      loadServerConfig({
        DATABASE_URL,
        HP_SIGNUP_CODE: 'family-code',
        HP_SEED_ALLOW_REMOTE: 'true',
      }),
    ).toThrow(/HP_SEED_ALLOW_REMOTE/);
    expect(() => loadConfig({ DATABASE_URL, HP_SEED_ALLOW_REMOTE: '1' })).toThrow(
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
