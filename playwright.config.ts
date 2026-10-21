import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/playwright',
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  // One baseline per screenshot name, shared across OSes. Accept new renderings from CI by
  // commenting "/accept-screenshot <name>.png" (or "/accept-screenshot all") on the PR, so the
  // committed baselines are Linux-rendered.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  expect: {
    // Font hinting and sub-pixel rendering differ slightly between hosts; tolerate a tiny bit.
    toHaveScreenshot: { maxDiffPixelRatio: 0.02 },
  },
  use: {
    colorScheme: 'light',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
