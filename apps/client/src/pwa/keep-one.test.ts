import { describe, expect, it } from 'vitest';
import { keepOne } from './keep-one.js';

describe('keepOne', () => {
  it('hands back the same thing on every call until it is dropped', () => {
    let made = 0;
    const get = keepOne(() => ({ id: (made += 1) }));
    const first = get();
    expect(get()).toBe(first);
    expect(get()).toBe(first);
    expect(made).toBe(1);
  });

  it('makes a fresh one after a drop', () => {
    let drop: () => void = () => undefined;
    const get = keepOne((d) => {
      drop = d;
      return {};
    });
    const first = get();
    drop();
    expect(get()).not.toBe(first);
  });
});
