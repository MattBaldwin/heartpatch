import type { GameData } from '../schemas/data/game-data.js';
import { BUILDINGS } from './buildings.js';
import { CARE_ACTIONS } from './care-actions.js';
import { ELEMENTS, FEELINGS } from './elements.js';
import { ELEMENT_MATRIX, FEELING_MATRIX, SYNERGY_TABLE } from './matrices.js';
import { RECIPES } from './recipes.js';
import { RESOURCES } from './resources.js';
import { SEASONS } from './seasons.js';
import { MOVES, SPECIES } from './species.js';

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
};
