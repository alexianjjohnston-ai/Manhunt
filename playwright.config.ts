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
  webServer: {
    command: 'npm run build && node --disable-warning=ExperimentalWarning dist/server/main.js',
    url: `http://localhost:${PORT}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'production',
      PORT: String(PORT),
      DATABASE_PATH: ':memory:',
      ALLOW_FAST_PINGS: 'true',
      ALLOW_SIMULATION: 'true',
      TRUST_PROXY: 'false',
      RATE_LIMIT_SCALE: '20',
    },
  },
});
