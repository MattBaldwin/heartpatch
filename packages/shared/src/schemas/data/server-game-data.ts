import { z } from 'zod';
import type { GameData } from './game-data.js';
import { checkRef, checkUniqueIds, formatDataIssues } from './issues.js';
import { SpawnTableSchema } from './spawn-tables.js';

/** Server-only tables (tech spec §2). Never sent to or bundled for the client. */
export const ServerGameDataSchema = z.strictObject({
  spawnTables: z.array(SpawnTableSchema),
});
export type ServerGameData = z.infer<typeof ServerGameDataSchema>;

/**
 * Validates server-only data against the public game data it refers to and
 * returns readable problems, or `[]` if it's all good.
 */
export function checkServerGameData(input: unknown, gameData: GameData): string[] {
  const schema = ServerGameDataSchema.superRefine((data, ctx) => {
    const report = (path: (string | number)[], message: string) => {
      ctx.addIssue({ code: 'custom', path, message });
    };
    const species = new Set(gameData.species.map((s) => s.id));
    const seasons = new Set(gameData.seasons.map((s) => s.id));

    checkUniqueIds('spawnTables', data.spawnTables, report);
    data.spawnTables.forEach((table, i) => {
      checkRef(seasons, 'season', table.season, ['spawnTables', i, 'season'], report);
      table.entries.forEach((entry, j) => {
        checkRef(
          species,
          'species',
          entry.species,
          ['spawnTables', i, 'entries', j, 'species'],
          report,
        );
      });
    });
  });
  const result = schema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}
