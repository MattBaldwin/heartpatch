import type { BuildInfo } from '../schemas/health.js';

/**
 * The game's major version (#198, owner decision 2026-10-06). Everything
 * before the full production launch is pre-v1 (`v0.<build>`); the owner sets
 * this to 1 when the full production game is published.
 */
export const APP_MAJOR = 0;

/**
 * The version line players see, e.g. `v0.214 · cb04682 · 2026-10-06`, or
 * `v0.dev` for a build made without git.
 */
export function formatAppVersion(build: BuildInfo | null): string {
  if (!build) return `v${String(APP_MAJOR)}.dev`;
  return `v${String(APP_MAJOR)}.${String(build.number)} · ${build.commit} · ${build.date}`;
}
