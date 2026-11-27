import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

/**
 * The e2e `test`: Playwright's, plus one automatic step after every test that closes every
 * browser context still open (#784).
 *
 * Specs make their players with `browser.newContext()` (players.ts `newPlayer`), and Playwright
 * closes only the context it made itself. Until this, 58 of 71 specs that made their own left
 * every player open, each with a live Babylon scene, in the worker's browser for the rest of the
 * job. On CI's software renderer that memory and CPU piled up file after file. iPad WebKit jobs
 * were SIGKILLed (exit 137) 20-25 min in and others crawled to the 45-min job limit
 * (2026-11-27). This is push.spec's afterEach from #397, for every spec at once.
 *
 * It runs after the spec's own afterEach hooks (fixtures tear down after hooks), so a hook that
 * reads a page (heartbeat.ts `reportHeartbeats`) still sees it.
 *
 * Every spec imports `test` from here; eslint.config.js fails a spec that imports it from
 * '@playwright/test'.
 */
export const test = base.extend<{ closeContexts: undefined }>({
  closeContexts: [
    async ({ browser }, use) => {
      await use(undefined);
      for (const context of browser.contexts()) await context.close();
    },
    { auto: true },
  ],
});
