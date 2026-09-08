import { defineConfig } from '@playwright/test';
import frontendConfig from './playwright.config';
const appTestUrl = process.env.PIXOTCHI_APP_TEST_URL ?? 'http://localhost:3000';

/** Opt-in real-provider journeys. Never records browser storage or bundles. */
export default defineConfig({
  ...frontendConfig,
  testDir: './tests/app-journeys',
  outputDir: 'output/playwright/app-journeys',
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'output/playwright/app-journey-report', open: 'never' }]],
  use: {
    ...frontendConfig.use,
    baseURL: appTestUrl,
    actionTimeout: 30_000,
    navigationTimeout: 90_000,
    permissions: ['clipboard-read', 'clipboard-write'],
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'app-phone-390', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, colorScheme: 'light', reducedMotion: 'reduce' } },
    { name: 'app-tablet-820', use: { browserName: 'chromium', viewport: { width: 820, height: 1180 }, colorScheme: 'light', reducedMotion: 'reduce' } },
    { name: 'app-desktop-1440', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 }, colorScheme: 'dark', reducedMotion: 'no-preference' } },
  ],
  // An explicit staging/local origin is owned by the caller; never start a
  // fallback dev server if its health check fails during integration work.
  webServer: process.env.PIXOTCHI_APP_TEST_URL ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
