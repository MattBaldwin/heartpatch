import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig({});
    expect(config.PORT).toBe(3000);
    expect(config.NODE_ENV).toBe('production');
    expect(config.TRUST_PROXY).toBe(false);
  });

  it('refuses invalid values and lists every problem', () => {
    expect(() => loadConfig({ PORT: 'abc', PUBLIC_ORIGIN: 'not a url' })).toThrow(
      /PORT[\s\S]*PUBLIC_ORIGIN/,
    );
  });
});
