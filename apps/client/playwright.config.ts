import { readdirSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { pinMapTime } from './tests/e2e/map-time.js';

const isCI = Boolean(process.env['CI']);
const testDir = './tests/e2e';

/**
 * CI's e2e groups, one job each per device. Playwright's own --shard splits by
 * test count in file order, which put every heavy WebGL spec on shard 1 (12 min
 * on iPad). These are balanced by measured WebKit time on both devices (#408:
 * per-test medians of six CI runs' list-reporter durations), simulating how
 * the 2 workers pull spec files in name order (a `parallel`-mode file,
 * friendly and tutorial-flow, hands out each test on its own). Each group
 * should take about 11-13 min on iPad (friendly's lighter) and 6-13 on
 * iPhone.
 *
 * Two specs need room beyond their own time (#408):
 * - friendly runs its two-phone tests side by side, so it fills both workers
 *   with four pages and everything in its group runs about 1.3-2.5 times
 *   slower. Its group stays light.
 * - hollow-dusk waits on the wall clock for a time zone at dusk (map-time.ts),
 *   up to 10 min when it starts late in an hour. That wait costs no CPU, so
 *   its group is planned for the whole wait on one worker.
 * Rebalance from the CI list reporter's durations when a group gets slow
 * (#246, #408).
 *
 * Every spec is listed in exactly one group; there is no catch-all, so a new
 * spec can't quietly pile onto one job (group 5 grew to 28 min that way, #296).
 * CI sets HP_E2E_GROUP=<i>/<n>: an unlisted or missing spec, a spec listed
 * twice, or a group count that doesn't match fails the run. Put a new spec in
 * the group with the least time, never friendly's or hollow-dusk's. Unset
 * (local runs) runs everything.
 */
const E2E_GROUPS = [
  // hollow-dusk's group: ~11.6 min with its whole dusk wait.
  [
    'admin',
    'hollow-dusk',
    'home',
    'lorebook',
    'recipe-book',
    'short-screens',
    'smoke',
    'tray-layout',
  ],
  // ~11.2 iPad, ~10.9 iPhone: tutorial-flow's two runs go side by side.
  [
    'battle',
    'battle-ui',
    'factory',
    'first-session',
    'map-hole',
    'territory',
    'tutorial-flow',
    'whats-new',
  ],
  // ~13.0 iPad, ~9.6 iPhone. It ran 17-22 min on iPad (the slowest job in every run, 4-6 min over
  // the next) until close-up, explore, fences and squishy-gallery moved out (#429).
  ['accessory-everywhere', 'account-help', 'dress-up', 'hollow', 'house', 'jobs', 'map', 'potions'],
  // friendly's group: ~7.6 iPad, ~6.1 iPhone with its slowdown counted, plus rare-reveal and patch-line (#391). Keep it light.
  [
    'cinematic',
    'clear-land',
    'friendly',
    'inventory',
    'milestones',
    'patch-line',
    'rare-reveal',
    'renderer-error',
    'roster',
    'starter',
    'version',
  ],
  // ~12.9 iPad, ~9.5 iPhone: taps alone is ~4.5-6.5.
  [
    'auth',
    'boutique',
    'capture',
    'care-layout',
    'chat',
    'fences',
    'lobby',
    'pwa',
    'taps',
    'trading-posts',
    'wild-picker',
  ],
  // ~13.0 iPad, ~8.7 iPhone: tutorial alone is ~5-7.
  [
    'audio',
    'care',
    'close-up',
    'explore',
    'keeper',
    'keeper-gallery',
    'raids',
    'squishy-gallery',
    'trade-split',
    'tutorial',
    'wardrobe',
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
// The Keeper's house (#381) ships behind HP_HOUSE (off by default); house.spec.ts
// needs it on, and stands in a home reply without it to check the off case.
process.env['HP_HOUSE'] ??= 'on';
// Live battles (#29): short turns and a short away-grace, so friendly.spec.ts
// can try a timeout and a disconnect without waiting 30 s and 60 s (20 s still
// leaves a slow software-rendered phone time to play a turn back). Dev and
// tests only.
process.env['HP_DEV_LIVE_TURN_SECONDS'] ??= '20';
process.env['HP_DEV_LIVE_GRACE_SECONDS'] ??= '6';
// Map time is the game clock in the patch's time zone, which the client takes
// from the device: pin the browser's zone so specs never meet dusk (#326).
const timezoneId = pinMapTime();

// iPad runs are slower than iPhone ones on CI: in one run (#429), five of the six iPad groups took
// 1.1-1.7 times as long as the same-numbered iPhone group (the sixth was shorter), and 19 of the 26
// first-try failures in 7 runs were iPad, several of them a 5 s `expect` default running out. Give
// its assertions twice that. Specs that set their own timeout keep it; iPhone and laptop stay at 5 s.
const IPAD_EXPECT = { timeout: 10_000 };

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
        expect: IPAD_EXPECT,
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
      { name: 'ipad-webkit', expect: IPAD_EXPECT, use: { ...devices['iPad Pro 11'] } },
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
