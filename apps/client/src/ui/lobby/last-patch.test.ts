import { describe, expect, it } from 'vitest';
import { forgetPatch, patchToResume, rememberPatch, type PatchStore } from './last-patch.js';

const store = (): PatchStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
};

describe('the last patch visited (#160)', () => {
  it('lands on the patch a player left, per account', () => {
    const s = store();
    rememberPatch('ana', 'map-1', s);
    rememberPatch('bo', 'map-2', s);
    expect(patchToResume('ana', [{ id: 'map-1' }, { id: 'map-2' }], s)).toBe('map-1');
    expect(patchToResume('bo', [{ id: 'map-2' }], s)).toBe('map-2');
    expect(patchToResume('cy', [{ id: 'map-1' }], s)).toBeNull();
  });

  it('forgets a patch the player is no longer in', () => {
    const s = store();
    rememberPatch('ana', 'map-1', s);
    expect(patchToResume('ana', [{ id: 'map-9' }], s)).toBeNull();
    expect(s.data.size).toBe(0);
  });

  it('forgets on request, and survives blocked storage', () => {
    const s = store();
    rememberPatch('ana', 'map-1', s);
    forgetPatch('ana', s);
    expect(patchToResume('ana', [{ id: 'map-1' }], s)).toBeNull();
    const blocked: PatchStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => {
      rememberPatch('ana', 'map-1', blocked);
    }).not.toThrow();
    expect(patchToResume('ana', [{ id: 'map-1' }], blocked)).toBeNull();
  });
});
