import { defineConfig, devices } from '@playwright/test'

/**
 * Browser selection.
 *
 * We drive the Google Chrome already installed on this machine rather than
 * downloading Playwright's ~195 MB bundled Chromium build. Chrome is a
 * supported channel, so this is a first-class configuration, not a workaround.
 *
 * Override with PLAYWRIGHT_CHANNEL=chromium (after `npx playwright install
 * chromium`) or =msedge where Chrome is unavailable, e.g. on CI runners.
 */
type Channel = 'chrome' | 'msedge' | 'chromium'
const channel = (process.env['PLAYWRIGHT_CHANNEL'] ?? 'chrome') as Channel

/**
 * Every e2e spec starts and stops its own server (see the specs), because each
 * case needs a differently-rooted site: a subpath mount, a rewrite-mode mount,
 * a rewrite-mode-without-rules mount, and so on.
 */
export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list']] : [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [{ name: channel, use: { ...devices['Desktop Chrome'], channel } }],
})
