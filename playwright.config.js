const { defineConfig } = require('@playwright/test');

if (process.env.CI && process.argv.some(arg => arg.startsWith('--update-snapshots') && arg !== '--update-snapshots=none')) {
  throw new Error('CI must compare approved snapshots; baseline updates are local review operations.');
}

module.exports = defineConfig({
  updateSnapshots: 'none',
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 8_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixels: 50,
    },
  },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['./tests/helpers/visual-evidence-reporter.cjs'],
  ],
  outputDir: 'test-results/runs',
  use: {
    headless: false,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
});
