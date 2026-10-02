import type { z } from 'zod';

export type Path = (string | number)[];
export type Report = (path: Path, message: string) => void;

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
