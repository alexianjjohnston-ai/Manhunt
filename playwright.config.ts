import { defineConfig, devices } from '@playwright/test';

const PORT = 8799;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 14'], browserName: 'chromium' } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      // Build once, then run both servers: :8799 (main) and :8798 (with a fake Google Maps key).
      command: 'npm run build && node scripts/e2e-servers.mjs',
      url: `http://localhost:${PORT}/api/health`,
      timeout: 180_000,
      reuseExistingServer: false,
    },
    {
      // Started by the launcher above; this entry only waits until it is up.
      command: 'node -e "setInterval(() => {}, 1 << 30)"',
      url: 'http://localhost:8798/api/health',
      timeout: 180_000,
      reuseExistingServer: true,
    },
  ],
});
