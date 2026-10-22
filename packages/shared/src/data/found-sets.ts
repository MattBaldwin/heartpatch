import type { FoundSet } from '../schemas/data/found-sets.js';

/** The Rekindled set (#306 Rewards): the joy a Hollowed village gets back, found only there. */
export const REKINDLED: FoundSet = {
  id: 'rekindled',
  name: 'Rekindled',
  where: 'in grey villages',
  pieces: [
    'lantern-glow-cap',
    'ember-patch-jacket',
    'ember-patch-trousers',
    'lantern-glow-boots',
    'joy-lantern-charm',
  ],
  // The sealed ingredients of the Joy Lantern and Heart Tea recipes.
  finds: ['joy-ember', 'heart-petals'],
  title: { id: 'rekindler', name: 'Rekindler' },
  coins: 50, // TUNE: a middle milestone tier's coins
};

/**
 * Found sets (#306 PR 5), checked by `checkFoundSets` in tests. Each set's
 * title is a milestone track (`MILESTONE_TRACKS`), earned by finding every
 * piece; where the pieces drop is server-only
 * (`data/server/hollowed-finds.ts`, CLAUDE.md rule 6). A later season adds a row here and its own drop tables.
 */
export const FOUND_SETS: FoundSet[] = [REKINDLED];
