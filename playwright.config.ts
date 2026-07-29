import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  // Soak loops are inherently slow; the fixtures keep them as short as they can
  // be while still producing a readable curve.
  timeout: 3 * 60 * 1000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
