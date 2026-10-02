import { z } from 'zod';
import { BuildingSchema } from './buildings.js';
import { CareActionSchema } from './care-actions.js';
import { ElementIdSchema, ElementSchema, FeelingIdSchema, FeelingSchema } from './elements.js';
import { ElementMatrixSchema, FeelingMatrixSchema, SynergyTableSchema } from './matrices.js';
import { MoveSchema } from './moves.js';
import { RecipeSchema } from './recipes.js';
import { ResourceSchema } from './resources.js';
import { SeasonSchema } from './seasons.js';
import { SpeciesSchema } from './species.js';
import { checkRef, checkUniqueIds, formatDataIssues, type Path, type Report } from './issues.js';

function checkCost(
  resources: ReadonlySet<string>,
  cost: Readonly<Record<string, number>> | undefined,
  path: Path,
  report: Report,
): void {
  for (const id of Object.keys(cost ?? {}))
    checkRef(resources, 'resource', id, [...path, id], report);
}

const ids = (rows: readonly { id: string }[]) => new Set(rows.map((r) => r.id));

/**
 * Every public content table, validated row by row and then cross-checked so
 * every id a row mentions exists (moves, evolutions, seasons, resources).
 */
export const GameDataSchema = z
  .strictObject({
    elements: z.array(ElementSchema),
    feelings: z.array(FeelingSchema),
    elementMatrix: ElementMatrixSchema,
    feelingMatrix: FeelingMatrixSchema,
    synergy: SynergyTableSchema,
    species: z.array(SpeciesSchema),
    moves: z.array(MoveSchema),
    resources: z.array(ResourceSchema),
    buildings: z.array(BuildingSchema),
    recipes: z.array(RecipeSchema),
    seasons: z.array(SeasonSchema),
    careActions: z.array(CareActionSchema),
  })
  .superRefine((data, ctx) => {
    const report: Report = (path, message) => {
      ctx.addIssue({ code: 'custom', path, message });
    };

    for (const table of [
      'elements',
      'feelings',
      'species',
      'moves',
      'resources',
      'buildings',
      'recipes',
      'seasons',
      'careActions',
    ] as const) {
      checkUniqueIds(table, data[table], report);
    }

    const elementIds = ids(data.elements);
    for (const id of ElementIdSchema.options) {
      if (!elementIds.has(id)) report(['elements'], `missing element "${id}"`);
    }
    const feelingIds = ids(data.feelings);
    for (const id of FeelingIdSchema.options) {
      if (!feelingIds.has(id)) report(['feelings'], `missing feeling "${id}"`);
    }

    const seasons = ids(data.seasons);
    const resources = ids(data.resources);
    const moves = ids(data.moves);
    const species = ids(data.species);

    data.species.forEach((s, i) => {
      checkRef(seasons, 'season', s.season, ['species', i, 'season'], report);
      s.moves.forEach((move, j) => {
        checkRef(moves, 'move', move, ['species', i, 'moves', j], report);
        if (s.moves.indexOf(move) !== j) {
          report(['species', i, 'moves', j], `move "${move}" is listed twice`);
        }
      });
      s.evolutions.forEach((evo, j) => {
        checkRef(species, 'species', evo.into, ['species', i, 'evolutions', j, 'into'], report);
        if (evo.into === s.id) {
          report(['species', i, 'evolutions', j, 'into'], 'a species cannot evolve into itself');
        }
      });
    });

    // Evolution chains must end: no species can evolve back into itself.
    const evolvesInto = new Map(data.species.map((s) => [s.id, s.evolutions.map((e) => e.into)]));
    const leadsBackTo = (start: string): boolean => {
      const seen = new Set<string>();
      const queue = [...(evolvesInto.get(start) ?? [])];
      for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
        if (id === start) return true;
        if (seen.has(id)) continue;
        seen.add(id);
        queue.push(...(evolvesInto.get(id) ?? []));
      }
      return false;
    };
    data.species.forEach((s, i) => {
      const direct = s.evolutions.some((e) => e.into === s.id);
      if (!direct && leadsBackTo(s.id)) {
        report(['species', i, 'evolutions'], 'evolution chain loops back to this species');
      }
    });

    data.resources.forEach((r, i) => {
      checkRef(seasons, 'season', r.season, ['resources', i, 'season'], report);
      if ((r.kind === 'seasonal') !== (r.season !== undefined)) {
        report(
          ['resources', i, 'season'],
          'seasonal resources need a season; others must not have one',
        );
      }
    });

    data.recipes.forEach((r, i) => {
      checkRef(seasons, 'season', r.season, ['recipes', i, 'season'], report);
      checkCost(resources, r.inputs, ['recipes', i, 'inputs'], report);
      checkRef(
        resources,
        'resource',
        r.output.resource,
        ['recipes', i, 'output', 'resource'],
        report,
      );
    });

    data.buildings.forEach((b, i) => {
      checkRef(seasons, 'season', b.season, ['buildings', i, 'season'], report);
      b.levels.forEach((level, j) => {
        checkCost(resources, level.cost, ['buildings', i, 'levels', j, 'cost'], report);
      });
      if (b.kind === 'hearthfire') {
        checkRef(resources, 'resource', b.fuelResource, ['buildings', i, 'fuelResource'], report);
      }
    });

    data.careActions.forEach((c, i) => {
      checkCost(resources, c.cost, ['careActions', i, 'cost'], report);
    });
  });
export type GameData = z.infer<typeof GameDataSchema>;

/**
 * Validates game data and returns readable problems, or `[]` if it's all
 * good. Tests assert this is empty for the shipped data.
 */
export function checkGameData(input: unknown): string[] {
  const result = GameDataSchema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}
