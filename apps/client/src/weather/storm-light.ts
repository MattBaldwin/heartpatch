import type { WEATHER_LOOK } from './weather-config.js';

/** Anything with a brightness: the sun, the storm's sky-wide light. */
export interface Lit {
  intensity: number;
}

/** The scene's sky light (Babylon's `Scene` is one). */
export interface Sky {
  environmentIntensity: number;
}

export interface StormLightTargets {
  readonly sun: Lit | null;
  readonly sky: Sky;
  /**
   * The storm's sky-wide light. Made with the layer and kept enabled at 0
   * until `arm`, so adding it never changes the scene's light count (#686).
   */
  readonly hemi: Lit;
  readonly pulse: (typeof WEATHER_LOOK)['storm']['flash'];
  readonly mood: (typeof WEATHER_LOOK)['storm']['mood'];
}

export interface StormLight {
  /** A storm over the patch now (as last applied). */
  readonly stormy: boolean;
  /** Lightning's flash (0..1) and whether a storm is over the patch. */
  apply(flash: number, overPatch: boolean): void;
  /** The first storm bank is in the sky: the sky-wide light joins in from now. */
  arm(): void;
  /** Puts the sun and the sky back to their own values, and the storm light to 0. */
  reset(): void;
}

/**
 * A flash lights the scene: the sun and the sky light rise with it, and a
 * sky-wide light lights the tiles on both tiers. A storm over the patch dims
 * the sun and the sky and leaves a faint cool light: the storm's mood. The
 * sun's and sky's own values are kept, and taken afresh if something else
 * (the night) changes them meanwhile: that value is the new base, and the
 * mood goes back on top of it.
 */
export function createStormLight(targets: StormLightTargets): StormLight {
  const { sun, sky, hemi, pulse, mood } = targets;
  let sunBase = sun?.intensity ?? 0;
  let sunSet = Number.NaN;
  let skyBase = sky.environmentIntensity;
  let skySet = Number.NaN;
  let stormy = false;
  let lit = Number.NaN;
  let armed = false;
  return {
    get stormy() {
      return stormy;
    },
    apply(now, overPatch) {
      const rewritten =
        (sun !== null && sun.intensity !== sunSet) || sky.environmentIntensity !== skySet;
      if (now === lit && overPatch === stormy && !rewritten) return;
      lit = now;
      stormy = overPatch;
      const dim = overPatch ? 1 : 0;
      if (sun) {
        if (sun.intensity !== sunSet) sunBase = sun.intensity;
        sunSet = sunBase * (1 - (1 - mood.sun) * dim) * (1 + pulse.sun * now);
        sun.intensity = sunSet;
      }
      if (sky.environmentIntensity !== skySet) skyBase = sky.environmentIntensity;
      skySet = skyBase * (1 - (1 - mood.sky) * dim) * (1 + pulse.sky * now);
      sky.environmentIntensity = skySet;
      hemi.intensity = armed ? pulse.hemi * now + mood.hemi * dim : 0;
    },
    arm() {
      if (armed) return;
      armed = true;
      lit = Number.NaN;
    },
    reset() {
      if (sun && sun.intensity === sunSet) sun.intensity = sunBase;
      if (sky.environmentIntensity === skySet) sky.environmentIntensity = skyBase;
      hemi.intensity = 0;
      lit = Number.NaN;
      stormy = false;
    },
  };
}
