import { describe, expect, it } from 'vitest';
import {
  forgetNames,
  REMEMBERED_NAMES_MAX,
  rememberedNames,
  rememberName,
  type NameStore,
} from './remembered-names.js';

const store = (): NameStore & { data: Map<string, string> } => {
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

const broken: NameStore = {
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

describe('names remembered on this device (#197)', () => {
  it('keeps the newest names first, at most three', () => {
    const s = store();
    expect(rememberedNames(s)).toEqual([]);
    rememberName('Pip_42', s);
    rememberName('MomBear', s);
    rememberName('Jojo', s);
    rememberName('DadDino', s);
    expect(REMEMBERED_NAMES_MAX).toBe(3);
    expect(rememberedNames(s)).toEqual(['DadDino', 'Jojo', 'MomBear']);
  });

  it('moves a name back to the front, whatever its case', () => {
    const s = store();
    rememberName('Pip_42', s);
    rememberName('Jojo', s);
    expect(rememberName('pip_42', s)).toEqual(['pip_42', 'Jojo']);
    expect(rememberedNames(s)).toEqual(['pip_42', 'Jojo']);
  });

  it('never stores anything but names', () => {
    const s = store();
    rememberName('Pip_42', s);
    expect([...s.data.values()]).toEqual(['["Pip_42"]']);
  });

  it('"Not you?" forgets them all', () => {
    const s = store();
    rememberName('Pip_42', s);
    rememberName('Jojo', s);
    forgetNames(s);
    expect(rememberedNames(s)).toEqual([]);
    expect(s.data.size).toBe(0);
  });

  it('treats junk as no names', () => {
    const s = store();
    s.data.set('heartpatch.rememberedNames.v1', '{not json');
    expect(rememberedNames(s)).toEqual([]);
    s.data.set('heartpatch.rememberedNames.v1', '{"a":1}');
    expect(rememberedNames(s)).toEqual([]);
    s.data.set('heartpatch.rememberedNames.v1', '["ok", 7, "", "fine"]');
    expect(rememberedNames(s)).toEqual(['ok', 'fine']);
  });

  it('works with storage blocked (private mode) or missing', () => {
    expect(rememberedNames(broken)).toEqual([]);
    expect(rememberName('Pip_42', broken)).toEqual(['Pip_42']);
    expect(() => {
      forgetNames(broken);
    }).not.toThrow();
    expect(rememberedNames(null)).toEqual([]);
  });
});
