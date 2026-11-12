import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/api',
  outputDir: './test-results/api',
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:4181', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'api-chrome',
      use: { ...devices['Desktop Chrome'], channel: process.env.CI ? undefined : 'chrome' },
    },
  ],
  webServer: {
    command: 'npm run start -- --hostname 127.0.0.1 --port 4181',
    url: 'http://127.0.0.1:4181/api/health',
    timeout: 30000,
    reuseExistingServer: false,
  },
});
