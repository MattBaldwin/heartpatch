import { z } from 'zod';
import { ContentIdSchema } from './common.js';
import {
  BranchTriggerSchema,
  EvolutionOddsSchema,
  type EvolutionCondition,
} from './evolution-odds.js';
import type { GameData } from './game-data.js';
import { checkRef, checkUniqueIds, formatDataIssues, type Report } from './issues.js';
import { MoveSchema } from './moves.js';
import { SpawnTableSchema } from './spawn-tables.js';
import { SpeciesSchema } from './species.js';
import { checkRosterArt, checkSpeciesArt } from './art-rules.js';
import { checkSpeciesVisual, visualRegistry } from './visuals.js';

/**
 * An evolution into a secret form (design doc §8). `from` is a public or
 * secret species; `into` is always a secret species. Evolutions into public
 * forms stay on the species (`Species.evolutions`). A secret form that is a
 * branch (not its step's default form, #32) carries its own `trigger`.
 */
export const SecretEvolutionSchema = z.strictObject({
  from: ContentIdSchema,
  into: ContentIdSchema,
  level: z.number().int().min(2).max(100),
  trigger: BranchTriggerSchema.optional(),
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
  /** Odds for public branches (#32): one row per public evolution that isn't its step's default. */
  evolutionOdds: z.array(EvolutionOddsSchema),
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

/** The ids a branch's conditions refer to exist. */
function checkConditions(
  conditions: readonly EvolutionCondition[],
  gameData: GameData,
  path: (string | number)[],
  report: Report,
): void {
  const buildings = new Set(gameData.buildings.map((b) => b.id));
  const seasons = new Set(gameData.seasons.map((s) => s.id));
  conditions.forEach((c, k) => {
    if (c.kind === 'fire-lit')
      checkRef(buildings, 'building', c.building, [...path, k, 'building'], report);
    if (c.kind === 'season') checkRef(seasons, 'season', c.season, [...path, k, 'season'], report);
  });
}

/**
 * Branches (#32): a species' evolutions at one level are a step, public ones
 * first. The first is the default form and has no odds; every other one is a
 * branch and needs them (an `evolutionOdds` row, or a secret evolution's
 * `trigger`).
 */
function checkBranches(data: ServerGameData, gameData: GameData, report: Report): void {
  const publicSpecies = new Set(gameData.species.map((s) => s.id));
  const secretSpecies = new Set(data.secretSpecies.map((s) => s.id));
  const species = new Set([...publicSpecies, ...secretSpecies]);
  const odds = new Map<string, number>();
  data.evolutionOdds.forEach((row, i) => {
    const key = `${row.from}>${row.into}`;
    if (odds.has(key))
      report(['evolutionOdds', i], `"${row.from}" → "${row.into}" is listed twice`);
    odds.set(key, i);
    checkRef(species, 'species', row.from, ['evolutionOdds', i, 'from'], report);
    if (row.trigger.kind === 'rare') {
      checkConditions(
        row.trigger.conditions,
        gameData,
        ['evolutionOdds', i, 'trigger', 'conditions'],
        report,
      );
    }
  });
  const used = new Set<string>();
  const rows = [...gameData.species, ...data.secretSpecies];
  for (const s of rows) {
    const steps = [
      ...s.evolutions.map((e) => ({ ...e, secret: -1 })),
      ...data.secretEvolutions.flatMap((e, i) => (e.from === s.id ? [{ ...e, secret: i }] : [])),
    ];
    const defaults = new Set<number>();
    const seen = new Set<string>();
    for (const step of steps) {
      // Unknown, self and repeated evolutions are reported above; they aren't forms.
      // So are public evolutions into secret forms and secret ones into public forms.
      const misplaced =
        step.secret >= 0 ? publicSpecies.has(step.into) : secretSpecies.has(step.into);
      if (!species.has(step.into) || step.into === s.id || seen.has(step.into) || misplaced)
        continue;
      seen.add(step.into);
      const key = `${s.id}>${step.into}`;
      const isDefault = !defaults.has(step.level);
      defaults.add(step.level);
      const row = odds.get(key);
      const secret = step.secret >= 0 ? data.secretEvolutions[step.secret] : undefined;
      const hasOdds = row !== undefined || secret?.trigger !== undefined;
      if (row !== undefined) used.add(key);
      const path = secret
        ? ['secretEvolutions', step.secret]
        : row !== undefined
          ? ['evolutionOdds', row]
          : ['evolutionOdds'];
      if (isDefault && hasOdds) {
        report(
          path,
          `"${step.into}" is the default form at level ${String(step.level)}, so it has no odds`,
        );
      }
      if (!isDefault && !hasOdds) {
        report(
          path,
          `"${s.id}" → "${step.into}" is a branch at level ${String(step.level)} and needs odds`,
        );
      }
      if (secret && row !== undefined) {
        report(
          ['evolutionOdds', row],
          `"${step.into}" is secret: put its trigger on the secret evolution`,
        );
      }
      if (secret?.trigger?.kind === 'rare') {
        checkConditions(
          secret.trigger.conditions,
          gameData,
          [...path, 'trigger', 'conditions'],
          report,
        );
      }
    }
  }
  data.evolutionOdds.forEach((row, i) => {
    if (!used.has(`${row.from}>${row.into}`)) {
      report(['evolutionOdds', i], `"${row.from}" has no evolution into "${row.into}"`);
    }
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
    // The secret lines grow up by the same rules as the public ones (once
    // their ids are sound: a clash with a public id is reported above).
    // TODO: a public → secret evolution isn't growth-checked (its base is
    // public), and secret lines aren't checked for distinct silhouettes
    // against public ones. Neither happens in today's data.
    if (!data.secretSpecies.some((s) => publicSpecies.has(s.id)))
      checkRosterArt(
        'secretSpecies',
        data.secretSpecies.map((s) => ({
          ...s,
          evolutions: data.secretEvolutions.filter((e) => e.from === s.id),
        })),
        visuals,
        gameData.artRules,
        report,
      );

    // Each species' public evolution levels (a secret form's own evolutions are public too).
    const publicSteps = new Map(
      [...gameData.species, ...data.secretSpecies].map((s) => [
        s.id,
        s.evolutions.map((e) => e.level),
      ]),
    );
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
      // A secret step before a public one would hide the evolving meter
      // (it can't show a secret form is coming) and read "Fully evolved!"
      // on a form that still has a public evolution ahead (#236).
      // No public evolution (Infinity): a secret one is its only next step, which is fine.
      const firstPublic = Math.min(...(publicSteps.get(evo.from) ?? []));
      if (Number.isFinite(firstPublic) && evo.level < firstPublic) {
        report(
          ['secretEvolutions', i, 'level'],
          `"${evo.from}" evolves into secret "${evo.into}" at level ${String(evo.level)}, before its public evolution at level ${String(firstPublic)}`,
        );
      }
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

    checkBranches(data, gameData, report);
  });
  const result = schema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}
