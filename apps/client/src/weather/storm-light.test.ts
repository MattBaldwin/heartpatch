import { describe, expect, it } from 'vitest';
import { createStormLight, type Lit, type Sky } from './storm-light.js';
import { WEATHER_LOOK } from './weather-config.js';

const { flash: pulse, mood } = WEATHER_LOOK.storm;

function rig(sunAt: number | null = 1, skyAt = 0.8) {
  const sun: Lit | null = sunAt === null ? null : { intensity: sunAt };
  const sky: Sky = { environmentIntensity: skyAt };
  const hemi: Lit = { intensity: 0 };
  const storm = createStormLight({ sun, sky, hemi, pulse, mood });
  return { sun, sky, hemi, storm };
}

describe('createStormLight', () => {
  it('leaves a clear sky alone', () => {
    const { sun, sky, hemi, storm } = rig();
    storm.apply(0, false);
    expect(sun?.intensity).toBe(1);
    expect(sky.environmentIntensity).toBe(0.8);
    expect(hemi.intensity).toBe(0);
  });

  it('dims the sun and the sky under a storm, and lifts them with a flash', () => {
    const { sun, sky, storm } = rig();
    storm.apply(0, true);
    expect(sun?.intensity).toBeCloseTo(mood.sun);
    expect(sky.environmentIntensity).toBeCloseTo(0.8 * mood.sky);
    expect(storm.stormy).toBe(true);
    storm.apply(1, true);
    expect(sun?.intensity).toBeCloseTo(mood.sun * (1 + pulse.sun));
    expect(sky.environmentIntensity).toBeCloseTo(0.8 * mood.sky * (1 + pulse.sky));
  });

  it('does not compound when applied again with nothing changed', () => {
    const { sun, sky, storm } = rig();
    storm.apply(0, true);
    storm.apply(0, true);
    storm.apply(0.5, true);
    storm.apply(0, true);
    expect(sun?.intensity).toBeCloseTo(mood.sun);
    expect(sky.environmentIntensity).toBeCloseTo(0.8 * mood.sky);
  });

  it('keeps the storm light at 0 until armed', () => {
    const { hemi, storm } = rig();
    storm.apply(1, true);
    expect(hemi.intensity).toBe(0);
    storm.arm();
    // Arming forces the next apply through, even with the same inputs.
    storm.apply(1, true);
    expect(hemi.intensity).toBeCloseTo(pulse.hemi + mood.hemi);
    storm.apply(0, false);
    expect(hemi.intensity).toBe(0);
  });

  describe('night re-basing', () => {
    it('takes the night’s sun as the new base mid-storm', () => {
      const { sun, sky, storm } = rig();
      storm.apply(0, true);
      sun!.intensity = 0.3; // the night turns the sun down
      storm.apply(0, true);
      expect(sun?.intensity).toBeCloseTo(0.3 * mood.sun);
      // The sky was not touched, so its base stays the day's.
      expect(sky.environmentIntensity).toBeCloseTo(0.8 * mood.sky);
    });

    it('takes the night’s sky as the new base, keeping the sun’s', () => {
      const { sun, sky, storm } = rig();
      storm.apply(0, true);
      sky.environmentIntensity = 0.2;
      storm.apply(0, true);
      expect(sky.environmentIntensity).toBeCloseTo(0.2 * mood.sky);
      expect(sun?.intensity).toBeCloseTo(mood.sun);
    });

    it('goes back to the night’s value, not the day’s, when the storm passes', () => {
      const { sun, sky, storm } = rig();
      storm.apply(0, true);
      sun!.intensity = 0.3;
      sky.environmentIntensity = 0.2;
      storm.apply(0, true);
      storm.apply(0, false);
      expect(sun?.intensity).toBeCloseTo(0.3);
      expect(sky.environmentIntensity).toBeCloseTo(0.2);
    });

    it('re-bases on a night write that lands mid-flash', () => {
      const { sun, storm } = rig();
      storm.apply(1, true);
      sun!.intensity = 0.5;
      storm.apply(0, true);
      expect(sun?.intensity).toBeCloseTo(0.5 * mood.sun);
    });

    it('re-bases when morning puts the day value back while dimmed', () => {
      const { sun, storm } = rig(0.3);
      storm.apply(0, true);
      sun!.intensity = 1; // morning: the day's sun, under the storm
      storm.apply(0, true);
      expect(sun?.intensity).toBeCloseTo(mood.sun);
    });

    it('re-bases to a night sun of 0 and back', () => {
      const { sun, storm } = rig();
      storm.apply(0, true);
      sun!.intensity = 0;
      storm.apply(0, true);
      expect(sun?.intensity).toBe(0);
      sun!.intensity = 1;
      storm.apply(0, false);
      expect(sun?.intensity).toBe(1);
    });

    it('works with no sun in the scene', () => {
      const { sky, storm } = rig(null);
      storm.apply(0, true);
      sky.environmentIntensity = 0.2;
      storm.apply(0, true);
      expect(sky.environmentIntensity).toBeCloseTo(0.2 * mood.sky);
    });
  });

  describe('reset', () => {
    it('puts back the bases it dimmed', () => {
      const { sun, sky, hemi, storm } = rig();
      storm.arm();
      storm.apply(1, true);
      storm.reset();
      expect(sun?.intensity).toBe(1);
      expect(sky.environmentIntensity).toBe(0.8);
      expect(hemi.intensity).toBe(0);
      expect(storm.stormy).toBe(false);
    });

    it('leaves a value someone else wrote since', () => {
      const { sun, storm } = rig();
      storm.apply(0, true);
      sun!.intensity = 0.3;
      storm.reset();
      expect(sun?.intensity).toBe(0.3);
    });
  });
});
