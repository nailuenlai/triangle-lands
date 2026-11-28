import { test, expect, type Page } from '@playwright/test';

async function waitFrame(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

test.describe('High-Quality Living Watercolor mode', () => {
  test.setTimeout(90_000);

  test('toggles cleanly via wordless HUD button, persists in localStorage, and renders across lighting presets with zero errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    });

    await page.route('**fonts.googleapis.com**', (route) => route.abort());
    await page.route('**fonts.gstatic.com**', (route) => route.abort());
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#btn-start');
    await page.locator('#btn-start').dispatchEvent('click');
    await expect(page.locator('#hud')).toBeVisible();

    const btn = page.locator('#btn-quality');
    await expect(btn).toBeVisible();

    // 1. Wordless UI & Standard baseline default
    expect((await btn.innerText()).trim(), '#btn-quality must stay strictly wordless').toBe('');
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => window.__game!.getQuality())).toBe('standard');

    // 2. Toggle Ultra mode ON via wordless HUD button
    await btn.dispatchEvent('pointerdown');
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(btn).toHaveClass(/ultra-on/);
    expect(await page.evaluate(() => window.__game!.getQuality())).toBe('ultra');
    expect(await page.evaluate(() => localStorage.getItem('triangle-explorer-quality'))).toBe('ultra');

    // 3. Render one verified frame each across Day, Golden Sunset, and Starry Night with zero WebGL errors
    for (const tod of [0.39, 0.725, 0.02]) {
      await page.evaluate((t) => {
        const g = window.__game!;
        g.setTime(t);
        g.setCamOverride([122, 9.2, 118], [90, 7.2, 137]);
      }, tod);
      await waitFrame(page);
    }

    // 4. Toggle back to Standard cleanly
    await btn.dispatchEvent('pointerdown');
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expect(btn).not.toHaveClass(/ultra-on/);
    expect(await page.evaluate(() => window.__game!.getQuality())).toBe('standard');
    expect(await page.evaluate(() => localStorage.getItem('triangle-explorer-quality'))).toBe('standard');

    expect(errors, 'Expected zero runtime/WebGL console errors').toEqual([]);
  });

  test('boots directly into Ultra mode when ?quality=ultra query param is present', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    });

    await page.route('**fonts.googleapis.com**', (route) => route.abort());
    await page.route('**fonts.gstatic.com**', (route) => route.abort());
    await page.goto('/?quality=ultra', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#btn-start');
    await page.locator('#btn-start').dispatchEvent('click');
    await expect(page.locator('#hud')).toBeVisible();
    await waitFrame(page);

    expect(await page.evaluate(() => window.__game!.getQuality())).toBe('ultra');
    await expect(page.locator('#btn-quality')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#btn-quality')).toHaveClass(/ultra-on/);
    expect(errors, 'Expected zero runtime/WebGL console errors').toEqual([]);
  });
});
