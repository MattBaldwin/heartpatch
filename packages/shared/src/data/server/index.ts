/**
 * `@heartpatch/shared/server`: server-only data (tech spec §2). The client
 * can't import this (lint rule + Vite `forbidServerData`), and the root
 * `@heartpatch/shared` entry never re-exports it.
 */
import type { ServerGameData } from '../../schemas/data/server-game-data.js';
import { SECRET_EVOLUTIONS, SECRET_MOVES, SECRET_SPECIES } from './secret-species.js';
import { SPAWN_TABLES } from './spawn-tables.js';

export * from '../../schemas/data/server-game-data.js';
export * from '../../schemas/data/spawn-tables.js';
export * from '../../schemas/data/spawn-rules.js';
export * from '../../spawns/resolve.js';
export * from '../../schemas/data/guardian-rules.js';
export * from '../../territory/guardians.js';
export { GUARDIAN_RULES } from './guardian-rules.js';
export * from '../../hollow/rescue-guardians.js';
export { RESCUE_GUARDIANS } from './rescue-guardians.js';
export * from '../../schemas/data/clothing-drops.js';
// Rolls the drop tables; its signature takes their type, so both live here.
export * from '../../wardrobe/index.js';
export { CLOTHING_DROPS } from './clothing-drops.js';
export * from '../../schemas/data/explore-finds.js';
export * from '../../explore/finds.js';
export { EXPLORE_FINDS } from './explore-finds.js';
export * from '../../schemas/data/lore-pages.js';
export * from '../../lore/index.js';
export { LORE_CHAPTERS, LORE_PAGES } from './lore-pages.js';
export * from '../../milestones/index.js';
export { SECRET_MILESTONES } from './secret-milestones.js';
export { serverBattleData } from './battle-data.js';
export { SECRET_EVOLUTIONS, SECRET_MOVES, SECRET_SPECIES } from './secret-species.js';
export { SPAWN_TABLES } from './spawn-tables.js';
export { SPAWN_RULES } from './spawn-rules.js';

export const SERVER_GAME_DATA: ServerGameData = {
  spawnTables: SPAWN_TABLES,
  secretSpecies: SECRET_SPECIES,
  secretMoves: SECRET_MOVES,
  secretEvolutions: SECRET_EVOLUTIONS,
};
