import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results/mock',
  testMatch: 'flows.spec.ts',
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'artifacts/playwright-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:5173', headless: true, trace: 'retain-on-failure' },
  projects: [
    { name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } },
    {
      name: 'mobile375',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 375, height: 812 },
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
  },
})
