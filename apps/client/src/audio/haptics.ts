import { BOSS_SFX } from './audio-config.js';

// A buzz you can feel on the boss's landing thump (#190 PR 4, owner answer 5).
// `navigator.vibrate` is only on Android (Chrome); iPhone and iPad Safari and
// the home-screen app have no vibration at all, and the iOS switch-control
// trick is a hack we don't ship to kids, so there this is a quiet no-op. The
// visual thump (the boss camera's shake, #190 PR 2) is for everyone. The buzz
// follows the Sounds switch: Sounds off, no buzz. Reduced motion turns off the
// camera's shake, not the buzz.

/** The bit of `navigator` this needs: `vibrate`, when the device has it. */
export interface VibrateTarget {
  readonly vibrate?: ((pattern: number | number[]) => boolean) | undefined;
}

export interface Haptics {
  /** The landing thump: buzzes if it can; true if it asked the device to. */
  thump: () => boolean;
}

export interface HapticsOptions {
  /** Where `vibrate` lives (default: the browser's `navigator`). */
  readonly target?: VibrateTarget | null;
  /** Whether sounds can play now (the Sounds switch on, its slider up). */
  readonly soundsOn: () => boolean;
}

export function createHaptics(options: HapticsOptions): Haptics {
  const target =
    options.target !== undefined
      ? options.target
      : typeof navigator === 'undefined'
        ? null
        : (navigator as VibrateTarget);
  return {
    thump: () => {
      if (typeof target?.vibrate !== 'function' || !options.soundsOn()) return false;
      try {
        // Called as a method: some browsers throw "Illegal invocation" otherwise.
        return target.vibrate([...BOSS_SFX.vibrateMs]);
      } catch {
        return false;
      }
    },
  };
}
