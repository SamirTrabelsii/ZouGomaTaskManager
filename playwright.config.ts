import { defineConfig, devices } from '@playwright/test';
import { TEST_DATABASE_URL } from './e2e/testdb';

const API_PORT = 3101;
const WEB_PORT = 5273;

/**
 * End-to-end tests run against their OWN API + dev server, wired to the `lifeos_test` database
 * (never the dev `lifeos` one). Needs `npm run db:up`; `npm run test:e2e` does the rest.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  expect: { timeout: 15_000 }, // the same slowness applies to what a page needs to show up (default is 5 s)
  timeout: 120_000, // software WebGL makes the 3D scene slow to re-render (35-45 s on an idle machine for the slowest test)
  workers: 1, // one shared test database
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    // WebGL needs a software fallback in headless Chromium; the app then picks its low quality tier.
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1280, height: 800 } } }],
  webServer: [
    {
      command: 'npx tsx e2e/test-server.ts', // the real app, with fixture calendar feeds
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { DATABASE_URL: TEST_DATABASE_URL, PORT: String(API_PORT), SERVE_STATIC: '0', COOKIE_SECURE: '0', ALLOW_REGISTRATION: '0', NODE_ENV: 'test' },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { LIFEOS_API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
