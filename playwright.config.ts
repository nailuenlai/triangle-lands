import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const localChrome = !process.env.CI
  ? [process.env.PLAYWRIGHT_CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].find(
      (p): p is string => !!p && fs.existsSync(p),
    )
  : undefined;

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
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
        ...(localChrome ? {} : { channel: 'chromium' }),
        launchOptions: {
          ...(localChrome ? { executablePath: localChrome } : {}),
          args: [
            '--enable-viewport',
            '--touch-events=enabled',
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
          ],
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
