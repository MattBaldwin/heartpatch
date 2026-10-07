import type { BuildInfo } from '@heartpatch/shared';

// This client's build (#198), baked in by vite.config.ts (`define`) from
// tooling/version/build-info.ts. Null for a build made without git (`v0.dev`).
declare const __HP_BUILD__: BuildInfo | null;

export const CLIENT_BUILD: BuildInfo | null =
  typeof __HP_BUILD__ === 'undefined' ? null : __HP_BUILD__;
