import { describe, expect, it, vi } from 'vitest';
import { BOSS_SFX } from './audio-config.js';
import { createHaptics } from './haptics.js';

describe('haptics (#190 PR 4)', () => {
  it('buzzes on the thump where the device can, with Sounds on', () => {
    const vibrate = vi.fn(() => true);
    const haptics = createHaptics({ target: { vibrate }, soundsOn: () => true });
    expect(haptics.thump()).toBe(true);
    expect(vibrate).toHaveBeenCalledWith([...BOSS_SFX.vibrateMs]);
  });

  it('is a no-op without vibrate (iPhone, iPad, the home-screen app)', () => {
    expect(createHaptics({ target: {}, soundsOn: () => true }).thump()).toBe(false);
    expect(createHaptics({ target: null, soundsOn: () => true }).thump()).toBe(false);
  });

  it('is a no-op with Sounds off, and follows the switch as it changes', () => {
    const vibrate = vi.fn(() => true);
    let on = false;
    const haptics = createHaptics({ target: { vibrate }, soundsOn: () => on });
    expect(haptics.thump()).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
    on = true;
    expect(haptics.thump()).toBe(true);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('never throws when the browser refuses', () => {
    const vibrate = vi.fn(() => {
      throw new Error('blocked');
    });
    expect(createHaptics({ target: { vibrate }, soundsOn: () => true }).thump()).toBe(false);
  });
});
