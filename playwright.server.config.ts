import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results/server',
  testMatch: 'server-ui.spec.ts',
  timeout: 60000,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'artifacts/server-browser-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:8080', headless: true, trace: 'retain-on-failure' },
  projects: [
    { name: 'server-chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'server-edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } },
    {
      name: 'server-mobile375',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 375, height: 812 },
      },
    },
  ],
})
