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
export { serverBattleData } from './battle-data.js';
export { SECRET_EVOLUTIONS, SECRET_MOVES, SECRET_SPECIES } from './secret-species.js';
export { SPAWN_TABLES } from './spawn-tables.js';

export const SERVER_GAME_DATA: ServerGameData = {
  spawnTables: SPAWN_TABLES,
  secretSpecies: SECRET_SPECIES,
  secretMoves: SECRET_MOVES,
  secretEvolutions: SECRET_EVOLUTIONS,
};
