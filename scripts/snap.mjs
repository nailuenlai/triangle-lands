import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const DEFAULT_SHOTS = [
  { name: 'start_north', x: 10, z: 70, yaw: 0, pitch: 0.14, tod: 0.39 },
  { name: 'peak_maple_shrine', x: 30, z: 57, lookTower: 3, pitch: 0.14, tod: 0.39 },
  { name: 'vista_canyon_to_start', camFromTower: 2, camLift: 28, lookTower: 0, tod: 0.39 },
];

function parseArgs(argv) {
  const opts = {
    url: '',
    out: '/tmp/triangle-lands-snaps',
    width: 1280,
    height: 720,
    shots: DEFAULT_SHOTS,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url' && argv[i + 1]) opts.url = argv[++i];
    else if (a === '--out' && argv[i + 1]) opts.out = argv[++i];
    else if (a === '--shots' && argv[i + 1]) opts.shots = JSON.parse(argv[++i]);
  }
  return opts;
}

function findChromeExecutable() {
  if (process.env.PLAYWRIGHT_CHROME_PATH && fs.existsSync(process.env.PLAYWRIGHT_CHROME_PATH)) {
    return process.env.PLAYWRIGHT_CHROME_PATH;
  }
  for (const candidate of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function isReachable(url) {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

async function startTempVite(port) {
  const proc = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    stdio: 'ignore',
    cwd: process.cwd(),
  });
  const url = `http://localhost:${port}/`;
  for (let i = 0; i < 60; i++) {
    if (await isReachable(url)) return { url, stop: () => proc.kill('SIGTERM') };
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.kill('SIGTERM');
  throw new Error(`Timed out waiting for temporary Vite server on port ${port}`);
}

const opts = parseArgs(process.argv.slice(2));
fs.mkdirSync(opts.out, { recursive: true });

let targetUrl = opts.url || 'http://localhost:5173/';
let tempServer = null;
if (!(await isReachable(targetUrl))) {
  tempServer = await startTempVite(4174);
  targetUrl = tempServer.url;
}

const executablePath = findChromeExecutable();
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});

const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height } });
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`);
});

try {
  await page.goto(targetUrl, { waitUntil: 'networkidle' });
  const startBtn = page.locator('#btn-start');
  if (await startBtn.isVisible()) {
    await startBtn.click();
    await page.waitForTimeout(400);
  }

  for (const shot of opts.shots) {
    await page.evaluate((s) => {
      const g = window.__game;
      if (!g) throw new Error('window.__game not found (requires Vite dev server)');
      if (typeof s.camFromTower === 'number') {
        const src = g.towers[s.camFromTower];
        const dst = g.towers[s.lookTower ?? 0];
        g.setTime(s.tod ?? 0.39);
        g.setCamOverride(
          [src.def.x, src.base + (s.camLift ?? 28), src.def.z],
          [dst.def.x, dst.base + 9, dst.def.z],
        );
      } else {
        let yaw = s.yaw ?? 0;
        if (typeof s.lookTower === 'number') {
          const t = g.towers[s.lookTower];
          yaw = Math.atan2(-(t.def.x - s.x), -(t.def.z - s.z));
        }
        g.snapAt(s.x, s.z, yaw, s.pitch ?? 0.16, s.tod ?? 0.39);
      }
    }, shot);
    await page.waitForTimeout(450);
    const outPath = path.join(opts.out, `${shot.name}.png`);
    await page.screenshot({ path: outPath });
    console.log(`Captured ${outPath}`);
  }
} finally {
  await browser.close();
  tempServer?.stop();
}

if (errors.length > 0) {
  console.error('Console/page errors detected:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
