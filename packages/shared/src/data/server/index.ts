/**
 * `@heartpatch/shared/server`: server-only data (tech spec §2). The client
 * can't import this (lint rule + Vite `forbidServerData`), and the root
 * `@heartpatch/shared` entry never re-exports it.
 */
import type { ServerGameData } from '../../schemas/data/server-game-data.js';
import { SPAWN_TABLES } from './spawn-tables.js';

export * from '../../schemas/data/server-game-data.js';
export * from '../../schemas/data/spawn-tables.js';
export { SPAWN_TABLES } from './spawn-tables.js';

export const SERVER_GAME_DATA: ServerGameData = {
  spawnTables: SPAWN_TABLES,
};
