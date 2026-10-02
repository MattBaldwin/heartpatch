import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env['CI']);

/**
 * Mobile Safari (WebKit) at iPhone and iPad sizes. Environments that can't
 * install WebKit can set PW_CHROMIUM_EXECUTABLE to run the same viewports in
 * a local Chromium instead (CI always uses WebKit).
 */
const chromiumPath = process.env['PW_CHROMIUM_EXECUTABLE'];

// The family signup code the dev server starts with, so e2e can sign up. The
// server inherits it; a reused local server reads the same default from .env.
process.env['HP_SIGNUP_CODE'] ??= 'heartpatch-dev-family';

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
    ]
  : [
      { name: 'iphone-webkit', use: { ...devices['iPhone 15'] } },
      { name: 'ipad-webkit', use: { ...devices['iPad Pro 11'] } },
    ];

export default defineConfig({
  testDir: './tests/e2e',
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
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
