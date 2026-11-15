import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

const chromium = process.env['PW_CHROMIUM_EXECUTABLE'];
const launchOptions = { executablePath: chromium };
export default defineConfig({
  ...base,
  testMatch: /zz-cap.*\.spec\.ts/,
  workers: 1,
  reporter: [['list']],
  projects: [
    {
      name: 'iphone-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 393, height: 852 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        launchOptions,
      },
    },
    {
      name: 'ipad-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 820, height: 1180 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        userAgent:
          'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        launchOptions,
      },
    },
  ],
});
