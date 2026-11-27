import { test, expect } from '@playwright/test';

test.describe('Shrine progressive sightline discovery', () => {
  test('boots cleanly with zero errors, skips discovery during intro swoop, and discovers distant shrines via clear/plume/vista sightlines', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    });

    await page.route('**fonts.googleapis.com**', (route) => route.abort());
    await page.route('**fonts.gstatic.com**', (route) => route.abort());
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#btn-start');
    await page.locator('#btn-start').tap();
    await expect(page.locator('#hud')).toBeVisible();

    // 1. During opening introSwoop, stepDiscovery must NOT prematurely discover distant shrines
    const duringSwoop = await page.evaluate(() => {
      const g = window.__game!;
      return g.stepDiscovery(0.3);
    });
    expect(duringSwoop.some(Boolean), 'introSwoop should not prematurely discover shrines').toBe(false);

    // 2. From START_POS (10, 70) looking north across the valley, 初始之碑 (165m) is discovered
    const afterStartLook = await page.evaluate(() => {
      const g = window.__game!;
      g.snapAt(10, 70, 0, 0.14, 0.39);
      return g.stepDiscovery(0.3);
    });
    expect(afterStartLook[0], '初始之碑 at 165m should be discovered from START_POS').toBe(true);

    // 3. From Peak (30, 57) overlooking South Maple Lake, 南湖之碑 (152m, altar tucked behind slope) is discovered via plume LOS
    const afterPeakLook = await page.evaluate(() => {
      const g = window.__game!;
      const t3 = g.towers[3];
      const yaw = Math.atan2(-(t3.def.x - 30), -(t3.def.z - 57));
      g.snapAt(30, 57, yaw, 0.14, 0.39);
      return g.stepDiscovery(0.3);
    });
    expect(afterPeakLook[3], '南湖之碑 at 152m should be discovered from summit ridge').toBe(true);

    // 4. In Vista mode (+28m) above 東崖之碑, looking toward reset 初始之碑 (181m) discovers it
    const afterVistaLook = await page.evaluate(() => {
      const g = window.__game!;
      const t0 = g.towers[0];
      const t2 = g.towers[2];
      t0.discovered = false;
      const yaw = Math.atan2(-(t0.def.x - t2.def.x), -(t0.def.z - t2.def.z));
      g.snapAt(t2.def.x, t2.def.z, yaw, 0.28, 0.39);
      g.startVista(t2);
      g.setYaw(yaw);
      g.setPitch(0.28);
      // Settle the Vista camera smoothly to its +28m aerial survey altitude
      let discovered = g.stepDiscovery(0.05);
      for (let i = 0; i < 150 && !discovered[0]; i++) {
        discovered = g.stepDiscovery(0.05);
      }
      return discovered;
    });
    expect(afterVistaLook[0], '初始之碑 at 181m should be discovered from Vista mode').toBe(true);

    expect(errors, 'Expected zero runtime/WebGL console errors').toEqual([]);
  });
});
