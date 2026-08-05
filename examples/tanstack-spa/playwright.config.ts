import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 3 * 60 * 1000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4174' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // A production build, not the dev server: HMR and the module graph allocate
    // on their own schedule and show up as noise in the heap curve.
    command: 'pnpm run build && pnpm run preview',
    url: 'http://localhost:4174',
    // Never reuse: the command bundles a build, and a server left over from an
    // earlier run would quietly serve stale code.
    reuseExistingServer: false,
    timeout: 120 * 1000,
  },
});
