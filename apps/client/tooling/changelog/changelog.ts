import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import type { ChangeAreaId, ChangeEntryView } from '@heartpatch/shared';
import { runGit } from '../version/build-info.js';

// "What's new" (#220): every change a tester can see gets one entry,
// `changes/<slug>.md`, written in the PR that makes it. This turns them into
// `changelog.json` for the client. An entry's build number is the commit
// count at the commit that added its file, the same count the version line
// shows (`v0.<build>`, #198), so it comes from git, never from the author.
// Without git history (a copy with `changes/` but no .git) entries have no
// build and the app lists them as "Coming next".
//
// The shape is shared's `ChangeEntrySchema`. Only its types are imported:
// this runs in the Vite config and the deploy's CLI, where the shared
// package may not be built yet. changelog.test.ts checks every real entry
// against the schema itself.

/** Every area once: the compiler checks this against shared's `ChangeAreaSchema`. */
const AREAS: Readonly<Record<ChangeAreaId, true>> = {
  battles: true,
  land: true,
  home: true,
  squishies: true,
  account: true,
  other: true,
};
export const CHANGE_AREAS = Object.keys(AREAS) as ChangeAreaId[];

export type ChangeEntry = ChangeEntryView;

/** Runs git in `cwd`; its trimmed output, or null if git can't answer. */
export type Git = (args: string[], cwd: string) => string | null;

const TRY_IT = /^\*\*Try it:\*\*\s*(.+)$/;

/** One entry file's words. Throws, naming the file, when a field is missing or wrong. */
export function parseEntry(text: string, file: string): Omit<ChangeEntry, 'build' | 'date'> {
  const fail = (why: string): never => {
    throw new Error(`${file}: ${why}`);
  };
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) fail('needs front matter between --- lines (title, area)');
  const [, head = '', rest = ''] = match ?? [];
  const fields = new Map<string, string>();
  for (const line of head.split(/\r?\n/)) {
    const field = /^([a-zA-Z]+):\s*(.*?)\s*$/.exec(line);
    if (field?.[1]) fields.set(field[1], field[2] ?? '');
  }
  const title = fields.get('title') ?? '';
  if (title === '') fail('front matter needs a title');
  // The area line may carry a ` # battles | land | …` reminder; a title keeps its #.
  const area = (fields.get('area') ?? '').replace(/\s+#.*$/, '');
  if (!(CHANGE_AREAS as readonly string[]).includes(area)) {
    fail(`area must be one of ${CHANGE_AREAS.join(', ')} (got "${area}")`);
  }
  let tryIt: string | null = null;
  const body: string[] = [];
  for (const line of rest.split(/\r?\n/)) {
    const found = TRY_IT.exec(line.trim());
    if (!found?.[1]) body.push(line);
    else if (tryIt !== null) fail('has two **Try it:** lines; keep one');
    else tryIt = found[1].trim();
  }
  const words = body
    .join('\n')
    .trim()
    .replace(/\s*\n\s*/g, ' ');
  if (words === '') fail('needs a line or two about what changed');
  return { slug: basename(file, '.md'), title, area: area as ChangeAreaId, body: words, tryIt };
}

/** The commit count and UTC date at the commit that first added `file`. */
export function buildOf(
  file: string,
  repo: string,
  git: Git,
): { build: number | null; date: string | null } {
  const path = relative(repo, file);
  // --follow: a renamed entry keeps the build it was first added at.
  const added = git(['log', '--follow', '--diff-filter=A', '--format=%H %cI', '--', path], repo);
  // Oldest last: the first time the file was added.
  const first = added?.split('\n').filter(Boolean).at(-1);
  const [sha, when] = first?.split(' ') ?? [];
  if (!sha || !when) return { build: null, date: null };
  const count = git(['rev-list', '--count', sha], repo);
  if (!count || !/^\d+$/.test(count)) return { build: null, date: null };
  return { build: Number(count), date: new Date(when).toISOString().slice(0, 10) };
}

/** Every entry in `dir`, newest build first ("Coming next" ones on top), then by slug. */
export function readChangelog(dir: string, repo: string, git: Git = runGit): ChangeEntry[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => {
      const file = join(dir, name);
      return { ...parseEntry(readFileSync(file, 'utf8'), file), ...buildOf(file, repo, git) };
    });
  const rank = (e: ChangeEntry) => e.build ?? Number.MAX_SAFE_INTEGER;
  return entries.sort((a, b) => rank(b) - rank(a) || a.slug.localeCompare(b.slug));
}

/** `changelog.json`'s text. */
export function changelogJson(entries: readonly ChangeEntry[]): string {
  return `${JSON.stringify({ entries }, null, 2)}\n`;
}
