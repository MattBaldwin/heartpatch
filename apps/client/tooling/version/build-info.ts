import { execFileSync } from 'node:child_process';
import type { BuildInfo } from '@heartpatch/shared';

// Which build this is (#198), worked out when Vite starts and baked into the
// client with `define` (vite.config.ts). The deploy passes APP_BUILD and
// APP_COMMIT as Docker build args, because the image's build context has no
// .git; anywhere else (CI, a laptop) git answers. With neither, the client
// says `v0.dev`.

export interface BuildSource {
  env: Record<string, string | undefined>;
  /** Runs git with these arguments; its trimmed output, or null if it can't. */
  git: (args: string[]) => string | null;
  now: Date;
}

const COUNT = /^[1-9]\d*$/;
const SHA = /^[0-9a-f]{7,40}$/;

function info(count: string, sha: string, now: Date): BuildInfo | null {
  if (!COUNT.test(count) || !SHA.test(sha)) return null;
  return { number: Number(count), commit: sha.slice(0, 7), date: now.toISOString().slice(0, 10) };
}

export function readBuildInfo(source: BuildSource): BuildInfo | null {
  const { APP_BUILD: build, APP_COMMIT: commit } = source.env;
  if (build || commit) {
    // The deploy asked for a version: a bad one fails the build, not the menu.
    const given = info(build ?? '', commit ?? '', source.now);
    if (!given) {
      throw new Error(`APP_BUILD=${build ?? ''} APP_COMMIT=${commit ?? ''}: not a build`);
    }
    return given;
  }
  const count = source.git(['rev-list', '--count', 'HEAD']);
  const sha = source.git(['rev-parse', 'HEAD']);
  return count && sha ? info(count, sha, source.now) : null;
}

/** git, or null when it isn't installed or this isn't a checkout. */
export function runGit(args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}
