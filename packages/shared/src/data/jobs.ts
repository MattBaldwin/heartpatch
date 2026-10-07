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
  // TUNE: land without a node gives its terrain's primary resource; gather
  // spots are the rarer secondary (owner decision on #238, the nesting
  // economy). Treats are cooked from Greens or grown on farm plots. Juniper's
  // Gap gives nothing to a gatherer.
  terrainYields: [
    { terrain: 'meadow', resource: 'greens', quantity: 2, seconds: 15 * 60 }, // TUNE:
    { terrain: 'forest', resource: 'timber', quantity: 2, seconds: 15 * 60 }, // TUNE:
    { terrain: 'old-forest', resource: 'emberwood', quantity: 1, seconds: 30 * 60 }, // TUNE:
    { terrain: 'hills', resource: 'stone', quantity: 2, seconds: 15 * 60 }, // TUNE:
    // TUNE: Ice replaces the slow Glimmer (#238); Glimmer stays on mountain spots.
    { terrain: 'mountains', resource: 'ice', quantity: 1, seconds: 20 * 60 },
    { terrain: 'lake', resource: 'water', quantity: 2, seconds: 15 * 60 }, // TUNE:
    { terrain: 'pumpkin-fields', resource: 'pumpkins', quantity: 1, seconds: 20 * 60 }, // TUNE:
  ],
  // TUNE: who is quick at what. Element side first, then feeling.
  affinities: [
    { resource: 'timber', icon: '🌲', elements: ['leaf'], feelings: ['brave'], seasons: [] },
    { resource: 'stone', icon: '🪨', elements: ['stone'], feelings: ['sleepy'], seasons: [] },
    { resource: 'emberwood', icon: '🔥', elements: ['fire'], feelings: ['cozy'], seasons: [] },
    {
      resource: 'glimmer',
      icon: '💎',
      elements: ['light', 'spark'],
      feelings: ['joy'],
      seasons: [],
    },
    // #238: Water squishies fetch Water now that land grows no Treats. Every
    // feeling already has a resource, so Greens and Ice share theirs. TUNE:
    { resource: 'water', icon: '💧', elements: ['water'], feelings: ['silly'], seasons: [] },
    { resource: 'greens', icon: '🌿', elements: ['leaf'], feelings: ['cozy'], seasons: [] },
    { resource: 'ice', icon: '🧊', elements: ['frost'], feelings: ['sleepy'], seasons: [] },
    {
      resource: 'pumpkins',
      icon: '🎃',
      elements: ['shadow'],
      feelings: ['spooky'],
      seasons: ['halloween'],
    },
    {
      // Only Thanksgiving squishies, so nobody gets a leaf hint all year.
      resource: 'magic-fallen-leaves',
      icon: '🍂',
      elements: [],
      feelings: [],
      seasons: ['thanksgiving'],
    },
  ],
  maxGatherHints: 2, // TUNE:
  // TUNE: owner decision 2026-10-06: at most a day of Training Grounds XP
  // waits to land, like a gatherer's full basket.
  training: { maxHours: 24 },
};
