import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:4173',
  },
  webServer: {
    command: 'npx vite --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
        channel: 'chromium',
        launchOptions: {
          args: ['--enable-viewport', '--touch-events=enabled'],
        },
      },
    },
    {
      name: 'mobile-safari',
      use: {
        ...devices['iPhone 13'],
      },
    },
  ],
});
