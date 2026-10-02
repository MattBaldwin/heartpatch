import { describe, expect, it } from 'vitest';
import { createUpdateHold } from './update-hold.js';

describe('createUpdateHold', () => {
  it('runs a listener right away when nothing is held', () => {
    const hold = createUpdateHold();
    let ran = 0;
    hold.whenReleased(() => ran++);
    expect(hold.held).toBe(false);
    expect(ran).toBe(1);
  });

  it('runs waiting listeners once, after the last hold is released', () => {
    const hold = createUpdateHold();
    const a = hold.hold();
    const b = hold.hold();
    let ran = 0;
    hold.whenReleased(() => ran++);
    a();
    a();
    expect(hold.held).toBe(true);
    expect(ran).toBe(0);
    b();
    expect(hold.held).toBe(false);
    expect(ran).toBe(1);
    hold.hold()();
    expect(ran).toBe(1);
  });
});
