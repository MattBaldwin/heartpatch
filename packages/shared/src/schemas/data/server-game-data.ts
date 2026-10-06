import { z } from 'zod';
import { ContentIdSchema } from './common.js';
import type { GameData } from './game-data.js';
import { checkRef, checkUniqueIds, formatDataIssues, type Report } from './issues.js';
import { MoveSchema } from './moves.js';
import { SpawnTableSchema } from './spawn-tables.js';
import { SpeciesSchema } from './species.js';
import { checkSpeciesArt } from './art-rules.js';
import { checkSpeciesVisual, visualRegistry } from './visuals.js';

/**
 * An evolution into a secret form (design doc §8). `from` is a public or
 * secret species; `into` is always a secret species. Evolutions into public
 * forms stay on the species (`Species.evolutions`).
 */
export const SecretEvolutionSchema = z.strictObject({
  from: ContentIdSchema,
  into: ContentIdSchema,
  level: z.number().int().min(2).max(100),
});
export type SecretEvolution = z.infer<typeof SecretEvolutionSchema>;

/**
 * Server-only tables (tech spec §2, CLAUDE.md rule 6). Never sent to or
 * bundled for the client. Secret species (and the moves only they know) use
 * the public row shapes, visual included, so a species can be sent to a
 * player once they meet it.
 */
export const ServerGameDataSchema = z.strictObject({
  spawnTables: z.array(SpawnTableSchema),
  secretSpecies: z.array(SpeciesSchema),
  secretMoves: z.array(MoveSchema),
  secretEvolutions: z.array(SecretEvolutionSchema),
});
export type ServerGameData = z.infer<typeof ServerGameDataSchema>;

/** Reports secret rows whose id is already used, in the secret table or the public one. */
function checkSecretIds(
  table: string,
  rows: readonly { id: string }[],
  publicIds: ReadonlySet<string>,
  what: string,
  report: Report,
): void {
  checkUniqueIds(table, rows, report);
  rows.forEach((row, i) => {
    if (publicIds.has(row.id))
      report([table, i, 'id'], `id "${row.id}" is already a public ${what}`);
  });
}

/**
 * Validates server-only data against the public game data it refers to and
 * returns readable problems, or `[]` if it's all good. Secret rows are
 * checked against public + secret data together.
 */
export function checkServerGameData(input: unknown, gameData: GameData): string[] {
  const schema = ServerGameDataSchema.superRefine((data, ctx) => {
    const report: Report = (path, message) => {
      ctx.addIssue({ code: 'custom', path, message });
    };
    const publicSpecies = new Set(gameData.species.map((s) => s.id));
    const secretSpecies = new Set(data.secretSpecies.map((s) => s.id));
    const species = new Set([...publicSpecies, ...secretSpecies]);
    const moves = new Set([...gameData.moves, ...data.secretMoves].map((m) => m.id));
    const seasons = new Set(gameData.seasons.map((s) => s.id));
    const terrains = new Set(gameData.terrains.map((t) => t.id));
    const visuals = visualRegistry(gameData);

    checkUniqueIds('spawnTables', data.spawnTables, report);
    data.spawnTables.forEach((table, i) => {
      checkRef(seasons, 'season', table.season, ['spawnTables', i, 'season'], report);
      table.terrains.forEach((terrain, j) => {
        checkRef(terrains, 'terrain', terrain, ['spawnTables', i, 'terrains', j], report);
      });
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

    checkSecretIds('secretSpecies', data.secretSpecies, publicSpecies, 'species', report);
    checkSecretIds(
      'secretMoves',
      data.secretMoves,
      new Set(gameData.moves.map((m) => m.id)),
      'move',
      report,
    );

    data.secretSpecies.forEach((s, i) => {
      checkSpeciesVisual(s.visual, visuals, ['secretSpecies', i, 'visual'], report);
      checkSpeciesArt(s, visuals, gameData.artRules, ['secretSpecies', i], report);
      checkRef(seasons, 'season', s.season, ['secretSpecies', i, 'season'], report);
      s.moves.forEach((move, j) => {
        checkRef(moves, 'move', move, ['secretSpecies', i, 'moves', j], report);
        if (s.moves.indexOf(move) !== j) {
          report(['secretSpecies', i, 'moves', j], `move "${move}" is listed twice`);
        }
      });
      s.evolutions.forEach((evo, j) => {
        const path = ['secretSpecies', i, 'evolutions', j, 'into'];
        if (secretSpecies.has(evo.into)) {
          report(path, `evolutions into secret forms go in secretEvolutions ("${evo.into}")`);
        } else {
          checkRef(publicSpecies, 'species', evo.into, path, report);
        }
      });
    });

    const pairs = new Set<string>();
    data.secretEvolutions.forEach((evo, i) => {
      checkRef(species, 'species', evo.from, ['secretEvolutions', i, 'from'], report);
      if (publicSpecies.has(evo.into)) {
        report(
          ['secretEvolutions', i, 'into'],
          `"${evo.into}" is a public species; put the evolution on the species instead`,
        );
      } else {
        checkRef(
          secretSpecies,
          'secret species',
          evo.into,
          ['secretEvolutions', i, 'into'],
          report,
        );
      }
      if (evo.into === evo.from) {
        report(['secretEvolutions', i, 'into'], 'a species cannot evolve into itself');
      }
      const pair = `${evo.from}>${evo.into}`;
      if (pairs.has(pair)) {
        report(['secretEvolutions', i], `"${evo.from}" → "${evo.into}" is listed twice`);
      }
      pairs.add(pair);
    });

    // Evolution chains must end. Public forms never evolve into secret ones,
    // so any loop through a secret form uses a secret evolution: flag each
    // one whose target can evolve back to its source.
    const evolvesInto = new Map<string, string[]>();
    const addEdge = (from: string, into: string) => {
      evolvesInto.set(from, [...(evolvesInto.get(from) ?? []), into]);
    };
    for (const s of [...gameData.species, ...data.secretSpecies]) {
      for (const evo of s.evolutions) addEdge(s.id, evo.into);
    }
    for (const evo of data.secretEvolutions) addEdge(evo.from, evo.into);
    const reaches = (start: string, target: string): boolean => {
      const seen = new Set<string>();
      const queue = [start];
      for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
        if (id === target) return true;
        if (seen.has(id)) continue;
        seen.add(id);
        queue.push(...(evolvesInto.get(id) ?? []));
      }
      return false;
    };
    data.secretEvolutions.forEach((evo, i) => {
      if (evo.from !== evo.into && reaches(evo.into, evo.from)) {
        report(['secretEvolutions', i], 'evolution chain loops back to this species');
      }
    });
  });
  const result = schema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}
