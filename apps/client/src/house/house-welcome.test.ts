import { describe, expect, it } from 'vitest';
import { localDayIn, welcomeOnce, type WelcomeStorage } from './house-welcome.js';

function memory(): WelcomeStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

describe('welcome home (#381 H2)', () => {
  it('welcomes once a patch day, per map', () => {
    const storage = memory();
    expect(welcomeOnce(storage, 'map-1', '2026-10-12')).toBe(true);
    expect(welcomeOnce(storage, 'map-1', '2026-10-12')).toBe(false);
    expect(welcomeOnce(storage, 'map-1', '2026-10-12')).toBe(false);
    // Another patch has its own welcome.
    expect(welcomeOnce(storage, 'map-2', '2026-10-12')).toBe(true);
    // The next day, once again.
    expect(welcomeOnce(storage, 'map-1', '2026-10-13')).toBe(true);
    expect(welcomeOnce(storage, 'map-1', '2026-10-13')).toBe(false);
  });

  it('counts storage that throws as already welcomed, so it never repeats in a loop', () => {
    const blocked: WelcomeStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(welcomeOnce(blocked, 'map-1', '2026-10-12')).toBe(false);
    expect(welcomeOnce(blocked, 'map-1', '2026-10-12')).toBe(false);
    // Readable but full: it can't remember, so it doesn't welcome.
    const full: WelcomeStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(welcomeOnce(full, 'map-1', '2026-10-12')).toBe(false);
    expect(welcomeOnce(null, 'map-1', '2026-10-12')).toBe(false);
  });

  it('reads the patch’s own day', () => {
    const late = new Date('2026-10-13T03:30:00Z'); // still the 12th in Chicago
    expect(localDayIn('America/Chicago', late)).toBe('2026-10-12');
    expect(localDayIn('UTC', late)).toBe('2026-10-13');
    // An unknown zone falls back to the device's, never throws.
    expect(localDayIn('Not/AZone', late)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
