import type { GameData } from '../schemas/data/game-data.js';
import { BUILDINGS } from './buildings.js';
import { CARE_ACTIONS } from './care-actions.js';
import { ELEMENTS, FEELINGS } from './elements.js';
import { MAP_GEN } from './map-gen.js';
import { ELEMENT_MATRIX, FEELING_MATRIX, SYNERGY_TABLE } from './matrices.js';
import { RECIPES } from './recipes.js';
import { RESOURCES } from './resources.js';
import { SEASONS } from './seasons.js';
import { MOVES as BASE_MOVES, SPECIES as BASE_SPECIES } from './species.js';
import { BRANCH_MOVES, BRANCH_OF, BRANCH_SPECIES } from './species-branches.js';

// #32 design prototype: the branch forms join the roster.
// Proposed nudges to existing forms (owner call).
const NUDGE: Record<string, number> = { dazzledrop: 0.97, maplecrunch: 1.12 };
const MOVES = [...BASE_MOVES, ...BRANCH_MOVES];
const SPECIES = [
  ...BASE_SPECIES.map((s) => {
    const b = BRANCH_OF[s.id];
    const nudge = NUDGE[s.id];
    const t = nudge
      ? {
          ...s,
          baseStats: {
            hp: Math.round(s.baseStats.hp * nudge),
            attack: Math.round(s.baseStats.attack * nudge),
            defense: Math.round(s.baseStats.defense * nudge),
            speed: Math.round(s.baseStats.speed * nudge),
          },
        }
      : s;
    return b ? { ...t, evolutions: [...t.evolutions, b] } : t;
  }),
  ...BRANCH_SPECIES,
];
import { TERRAINS } from './terrains.js';
import { ART_RULES, BODIES, PARTS } from './visuals.js';

/** Every public content table, checked by `checkGameData` in tests. */
export const GAME_DATA: GameData = {
  elements: ELEMENTS,
  feelings: FEELINGS,
  elementMatrix: ELEMENT_MATRIX,
  feelingMatrix: FEELING_MATRIX,
  synergy: SYNERGY_TABLE,
  species: SPECIES,
  moves: MOVES,
  resources: RESOURCES,
  buildings: BUILDINGS,
  recipes: RECIPES,
  seasons: SEASONS,
  careActions: CARE_ACTIONS,
  terrains: TERRAINS,
  mapGen: MAP_GEN,
  bodies: BODIES,
  parts: PARTS,
  artRules: ART_RULES,
};
