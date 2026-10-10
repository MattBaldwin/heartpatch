import type { EvolutionOdds, EvolutionRules } from '../../schemas/data/evolution-odds.js';

/*
 * Branching evolution (#32, design doc §8; owner-approved 2026-10-10).
 * Secret (CLAUDE.md rule 6): server-only. Odds of a branch with care score c:
 * aimed 150 × (1 + 0.6c) against the default form's 100 (60% to 71%),
 * unaimed 8 × (1 + 0.6c) (about 7%). One aimed miss doubles it; after two,
 * it's certain.
 */
export const EVOLUTION_RULES: EvolutionRules = {
  weights: {
    default: 100, // TUNE:
    unaimed: 8, // TUNE:
    aimed: 150, // TUNE:
    careBoost: 1.6, // TUNE:
  },
  pity: { boostAfter: 1, boost: 2, guaranteeAfter: 2 }, // TUNE:
  lean: {
    halfLifeHours: 96, // TUNE: "lately" is about four days
    headStart: 6, // TUNE:
    care: {
      feed: { feeling: 'cozy', points: 2 }, // TUNE:
      pet: { feeling: 'sleepy', points: 2 }, // TUNE:
      play: { feeling: 'silly', points: 2 }, // TUNE:
      'heart-snack': { feeling: 'joy', points: 3 }, // TUNE:
    },
    win: { feeling: 'brave', points: 1 }, // TUNE:
    nightWatch: { feeling: 'spooky', points: 2 }, // TUNE:
    habitat: { points: 1, hours: 6 }, // TUNE:
  },
  whisper: {
    fromPercent: 50, // TUNE:
    feelings: {
      joy: {
        icon: '💭',
        text: '{name} has been feeling very happy lately…',
        sub: 'Something about it is changing.',
      },
      cozy: {
        icon: '💭',
        text: '{name} has been feeling very cozy lately…',
        sub: 'Something about it is changing.',
      },
      brave: {
        icon: '💭',
        text: '{name} has been feeling very brave lately…',
        sub: 'Something about it is changing.',
      },
      silly: {
        icon: '💭',
        text: '{name} has been feeling very giggly lately…',
        sub: 'Something about it is changing.',
      },
      sleepy: {
        icon: '💭',
        text: '{name} has been feeling very sleepy lately…',
        sub: 'Something about it is changing.',
      },
      spooky: {
        icon: '💭',
        text: '{name} has been feeling a little spooky lately…',
        sub: 'Something about it is changing.',
      },
    },
  },
};

/**
 * Public branches (#32): how each is reached. The forms land in batches of
 * about five, each with owner screenshot approval.
 */
export const EVOLUTION_ODDS: EvolutionOdds[] = [
  // Batch 1: the starters' lines first.
  { from: 'puddlepuff', into: 'drizzledoze', trigger: { kind: 'feeling', feeling: 'sleepy' } },
  { from: 'emberbun', into: 'embernap', trigger: { kind: 'feeling', feeling: 'sleepy' } },
  { from: 'thistlepip', into: 'petalprance', trigger: { kind: 'feeling', feeling: 'joy' } },
  { from: 'fuzzbolt', into: 'glidebolt', trigger: { kind: 'feeling', feeling: 'joy' } },
  { from: 'snoozicle', into: 'twirlicle', trigger: { kind: 'feeling', feeling: 'silly' } },
];
