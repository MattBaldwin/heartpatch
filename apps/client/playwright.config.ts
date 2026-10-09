import { readdirSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { pinMapTime } from './tests/e2e/map-time.js';

const isCI = Boolean(process.env['CI']);
const testDir = './tests/e2e';

/**
 * CI's e2e groups, one job each per device. Playwright's own --shard splits by
 * test count in file order, which put every heavy WebGL spec on shard 1 (12 min
 * on iPad). These are balanced by measured iPad WebKit time (the slower device,
 * 2 workers): about 15-16 min of tests each, so about 8-9 min a job. A spec
 * file runs on one worker, so a slow file sets its group's floor: taps (about
 * 9 min) and tutorial (about 8) each sit in a group of light specs that the
 * other worker drains. Files start in name order, so what sorts before the big
 * file must be short: admin and auth before taps (under 1.5 min together);
 * tutorial-flow before tutorial, whose second (desktop-only) test skips at
 * once in CI and frees a worker. Rebalance from the CI list reporter's
 * durations when a group gets slow (#246).
 *
 * Every spec is listed in exactly one group; there is no catch-all, so a new
 * spec can't quietly pile onto one job (group 5 grew to 28 min that way, #296).
 * CI sets HP_E2E_GROUP=<i>/<n>: an unlisted or missing spec, a spec listed
 * twice, or a group count that doesn't match fails the run. Put a new spec in
 * the group with the least time. Unset (local runs) runs everything.
 */
const E2E_GROUPS = [
  // ~15.8 min of tests: taps alone is ~8.7.
  ['admin', 'auth', 'taps', 'trading-posts', 'tray-layout', 'wild-picker'],
  // ~15.2: tutorial alone is ~7.6; tutorial-flow's runs go side by side.
  ['tutorial', 'tutorial-flow', 'version', 'wardrobe', 'whats-new'],
  ['audio', 'battle', 'capture', 'close-up', 'fences', 'map', 'milestones', 'potions'],
  ['care', 'cinematic', 'explore', 'hollow', 'inventory', 'keeper', 'recipe-book', 'short-screens'],
  [
    'battle-ui',
    'boutique',
    'factory',
    'first-session',
    'hollow-dusk',
    'keeper-gallery',
    'lorebook',
    'smoke',
    'starter',
  ],
  [
    'account-help',
    'chat',
    'home',
    'jobs',
    'lobby',
    'pwa',
    'raids',
    'renderer-error',
    'squishy-gallery',
    'territory',
    'trade-split',
  ],
];

function e2eGroup(value: string | undefined): { testMatch?: string[] } {
  if (value === undefined || value === '') return {};
  const listed = E2E_GROUPS.flat();
  const match = /^(\d+)\/(\d+)$/.exec(value);
  const index = Number(match?.[1]);
  const total = Number(match?.[2]);
  if (!match || total !== E2E_GROUPS.length || index < 1 || index > total) {
    throw new Error(`HP_E2E_GROUP=${value}: expected <i>/${String(E2E_GROUPS.length)}`);
  }
  const duplicate = listed.find((spec, i) => listed.indexOf(spec) !== i);
  if (duplicate) throw new Error(`E2E_GROUPS lists ${duplicate}.spec.ts twice`);
  const onDisk = readdirSync(new URL(testDir, import.meta.url))
    .filter((file) => file.endsWith('.spec.ts'))
    .map((file) => file.slice(0, -'.spec.ts'.length));
  const missing = listed.filter((spec) => !onDisk.includes(spec));
  if (missing.length > 0) {
    throw new Error(`E2E_GROUPS lists missing specs: ${missing.join(', ')}`);
  }
  const unlisted = onDisk.filter((spec) => !listed.includes(spec));
  if (unlisted.length > 0) {
    throw new Error(
      `Add ${unlisted.map((spec) => `${spec}.spec.ts`).join(', ')} to a group in E2E_GROUPS (playwright.config.ts)`,
    );
  }
  return { testMatch: (E2E_GROUPS[index - 1] ?? []).map((spec) => `**/${spec}.spec.ts`) };
}

/**
 * Mobile Safari (WebKit) at iPhone and iPad sizes. Environments that can't
 * install WebKit can set PW_CHROMIUM_EXECUTABLE to run the same two viewports,
 * plus a laptop-sized window, in a local Chromium instead (CI always uses WebKit).
 */
const chromiumPath = process.env['PW_CHROMIUM_EXECUTABLE'];

// The family signup code the dev server starts with, so e2e can sign up. The
// server inherits it; a reused local server reads the same default from .env.
process.env['HP_SIGNUP_CODE'] ??= 'heartpatch-dev-family';
// Every device project signs up fresh players from this one IP, which the
// per-IP signup limit (10 an hour) can't cover; dev and tests only.
process.env['HP_DEV_SIGNUP_LIMIT_PER_IP'] ??= '500';
// The same for making patches (20 an hour per IP): every device project makes
// its own. Dev and tests only.
process.env['HP_DEV_MAP_CREATE_LIMIT_PER_IP'] ??= '500';
// Battles (#13) need a squishy and a wild opponent, which spawns (#14) and the
// tutorial's starter don't hand out yet; the dev routes do. Dev and tests only.
process.env['HP_DEV_SQUISHY_GRANTS'] ??= 'true';
// Map time is the game clock in the patch's time zone, which the client takes
// from the device: pin the browser's zone so specs never meet dusk (#326).
const timezoneId = pinMapTime();

const projects = chromiumPath
  ? [
      {
        name: 'iphone-chromium',
        use: {
          ...devices['iPhone 15'],
          browserName: 'chromium' as const,
          launchOptions: { executablePath: chromiumPath },
        },
      },
      {
        name: 'ipad-chromium',
        use: {
          ...devices['iPad Pro 11'],
          browserName: 'chromium' as const,
          launchOptions: { executablePath: chromiumPath },
        },
      },
      {
        // A laptop browser (the owner's playtests): a mouse on a big window.
        // Touch stays on so the specs' `tap()` calls work here too.
        name: 'desktop-chromium',
        use: {
          ...devices['Desktop Chrome'],
          viewport: { width: 1440, height: 900 },
          hasTouch: true,
          browserName: 'chromium' as const,
          launchOptions: { executablePath: chromiumPath },
        },
      },
    ]
  : [
      { name: 'iphone-webkit', use: { ...devices['iPhone 15'] } },
      { name: 'ipad-webkit', use: { ...devices['iPad Pro 11'] } },
    ];

export default defineConfig({
  testDir,
  ...e2eGroup(process.env['HP_E2E_GROUP']),
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  // In CI, list prints every test's duration in the job log (for balancing E2E_GROUPS).
  reporter: isCI ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    timezoneId,
  },
  projects,
  webServer: [
    {
      command: 'pnpm --filter @heartpatch/server dev',
      url: 'http://localhost:3000/api/v1/health',
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @heartpatch/client dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
    {
      // A production build for the installed-app specs (pwa.spec.ts): the dev
      // server never registers the service worker. Proxies /api like dev.
      command:
        'pnpm --filter @heartpatch/client build && pnpm --filter @heartpatch/client preview --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
