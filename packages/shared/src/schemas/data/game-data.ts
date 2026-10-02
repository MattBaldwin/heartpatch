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

type Path = (string | number)[];
type Report = (path: Path, message: string) => void;

/** Reports every id that appears more than once in a table. */
export function checkUniqueIds(
  table: string,
  rows: readonly { id: string }[],
  report: Report,
): void {
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    if (seen.has(row.id)) report([table, i, 'id'], `duplicate id "${row.id}"`);
    seen.add(row.id);
  });
}

/** Reports a reference to an id that isn't in `known`. */
export function checkRef(
  known: ReadonlySet<string>,
  what: string,
  id: string | undefined,
  path: Path,
  report: Report,
): void {
  if (id !== undefined && !known.has(id)) report(path, `unknown ${what} "${id}"`);
}

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

function hasId(value: unknown): value is { id: string } {
  return (
    typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string'
  );
}

/**
 * Renders a zod issue path against the data it came from, naming rows by id
 * instead of index: `species["puddlepuff"].baseStats.hp`.
 */
export function describeDataPath(root: unknown, path: readonly PropertyKey[]): string {
  let node: unknown = root;
  let out = '';
  for (const key of path) {
    const child: unknown =
      typeof node === 'object' && node !== null ? Reflect.get(node, key) : undefined;
    if (typeof key === 'number') {
      out += hasId(child) ? `["${child.id}"]` : `[${key}]`;
    } else {
      out += out === '' ? String(key) : `.${String(key)}`;
    }
    node = child;
  }
  return out === '' ? '(root)' : out;
}

/** One readable line per issue: `<where>: <what>`. */
export function formatDataIssues(root: unknown, error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    // A bad record key carries the useful message on its nested issue.
    const message =
      issue.code === 'invalid_key'
        ? `invalid key (${issue.issues.map((i) => i.message).join('; ')})`
        : issue.message;
    return `${describeDataPath(root, issue.path)}: ${message}`;
  });
}

/**
 * Validates game data and returns readable problems, or `[]` if it's all
 * good. Tests assert this is empty for the shipped data.
 */
export function checkGameData(input: unknown): string[] {
  const result = GameDataSchema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}
