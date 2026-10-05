import type { JobRules } from '../schemas/data/jobs.js';

/**
 * Squishy jobs (owner decisions 2026-10-04): gatherers, their matches and
 * what owned land yields. Checked by `checkJobRules` in tests; the server
 * works every number out from here and the job board explains the same ones.
 */
export const JOB_RULES: JobRules = {
  work: {
    // TUNE: a squishy takes twice the Keeper's time per gather, but repeats on its own.
    cyclePercent: 200,
    // TUNE: four gathers waiting, then it naps until someone collects.
    maxStoredCycles: 4,
    // TUNE: like the habitat match (DECISIONS "XP maths is whole percents").
    match: { onePercent: 135, bothPercent: 175 },
  },
  // TUNE: land without a node gives less than a node does (design doc §12 sources).
  // Meadows grow a few Treats; lakes and Juniper's Gap give nothing to a gatherer.
  terrainYields: [
    { terrain: 'meadow', resource: 'treats', quantity: 1, seconds: 20 * 60 }, // TUNE:
    { terrain: 'forest', resource: 'timber', quantity: 2, seconds: 15 * 60 }, // TUNE:
    { terrain: 'old-forest', resource: 'emberwood', quantity: 1, seconds: 30 * 60 }, // TUNE:
    { terrain: 'hills', resource: 'stone', quantity: 2, seconds: 15 * 60 }, // TUNE:
    { terrain: 'mountains', resource: 'stone', quantity: 2, seconds: 15 * 60 }, // TUNE:
    { terrain: 'pumpkin-fields', resource: 'pumpkins', quantity: 1, seconds: 20 * 60 }, // TUNE:
  ],
  // TUNE: who is quick at what. Element side first, then feeling.
  affinities: [
    { resource: 'timber', icon: '🌲', elements: ['leaf'], feelings: ['brave'], seasons: [] },
    { resource: 'stone', icon: '🪨', elements: ['stone'], feelings: ['sleepy'], seasons: [] },
    { resource: 'emberwood', icon: '🔥', elements: ['fire'], feelings: ['cozy'], seasons: [] },
    {
      resource: 'glimmer',
      icon: '✨',
      elements: ['light', 'spark'],
      feelings: ['joy'],
      seasons: [],
    },
    { resource: 'treats', icon: '🍪', elements: ['water'], feelings: ['silly'], seasons: [] },
    {
      resource: 'pumpkins',
      icon: '🎃',
      elements: ['shadow'],
      feelings: ['spooky'],
      seasons: ['halloween'],
    },
  ],
  maxGatherHints: 2, // TUNE:
};
