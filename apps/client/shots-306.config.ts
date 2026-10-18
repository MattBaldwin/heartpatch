import { defineConfig, devices } from '@playwright/test';
import { pinMapTime } from './tests/e2e/map-time.js';

// PROTOTYPE (#306 plan): mockup captures at the owner's viewports, in the
// pre-installed Chromium (sessions can't run WebKit). Reuses the running dev
// servers. Not part of CI's groups.
const chromiumPath = process.env['PW_CHROMIUM_EXECUTABLE'] ?? '/opt/pw-browsers/chromium';
process.env['HP_SIGNUP_CODE'] ??= 'heartpatch-dev-family';
const timezoneId = pinMapTime();
const launchOptions = { executablePath: chromiumPath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] };

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/shots-306*.spec.ts',
  timeout: 900_000,
  retries: 0,
  reporter: 'list',
  outputDir: process.env['HP_SHOTS_OUT'] ?? './test-results-shots',
  use: { baseURL: 'http://localhost:5173', timezoneId },
  projects: [
    { name: 'iphone15', use: { ...devices['iPhone 15'], browserName: 'chromium', launchOptions } },
    { name: 'se', use: { ...devices['iPhone SE'], browserName: 'chromium', launchOptions } },
    {
      name: 'ipad',
      use: {
        ...devices['iPad Pro 11'],
        viewport: { width: 820, height: 1180 },
        browserName: 'chromium',
        launchOptions,
      },
    },
  ],
});
