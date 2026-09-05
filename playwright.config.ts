import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/frontend',
  outputDir: 'output/frontend-tests',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: 'output/frontend-test-report', open: 'never' }]],
  use: { baseURL: 'http://localhost:3000', timezoneId: 'UTC', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [...[320, 390, 820, 864, 1024, 1440].flatMap(width => ['light', 'dark'].map(theme => ({
    name: `${width}-${theme}`,
    use: { browserName: 'chromium' as const, viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: theme as 'light' | 'dark', reducedMotion: 'reduce' as const },
  }))), ...[390, 1024].map(width => ({
    name: `webkit-${width}-${width === 390 ? 'light' : 'dark'}`,
    use: { browserName: 'webkit' as const, viewport: { width, height: 844 }, colorScheme: width === 390 ? 'light' as const : 'dark' as const, reducedMotion: 'reduce' as const },
  }))],
  webServer: { command: 'npm run dev', url: 'http://localhost:3000/qa/frontend', reuseExistingServer: !process.env.CI, timeout: 120000 },
});
