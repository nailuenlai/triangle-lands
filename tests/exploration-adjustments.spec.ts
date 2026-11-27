import { test, expect, type Page } from '@playwright/test';

interface DevGame {
  player: {
    pos: { x: number; y: number; z: number; toArray: () => number[] };
    facing: number;
    mode: string;
  };
  towers: { def: { x: number; z: number }; base: number; discovered: boolean }[];
  wonders: { def: { id: string; x: number; z: number }; baseY: number; discovered: boolean }[];
  gameMap: {
    getView: () => { zoom: number; centerX: number; centerZ: number };
    getTargetView: () => { zoom: number; centerX: number; centerZ: number };
    worldToCanvas: (x: number, z: number, size: number) => [number, number];
  };
  audio: { lastBreezeVol: number };
  visitedBiomes: Set<number>;
  getPoiFocus: () => { focus: number; kind: string };
  getFov: () => number;
  getBaseFov: () => number;
  snapAt: (x: number, z: number, yaw: number, pitch: number, tod: number) => void;
  setYaw: (yaw: number) => void;
  openMap: () => void;
  closeMap: () => void;
  stepDiscovery: (dt?: number) => boolean[];
  stepSystems: (n: number, dt?: number) => void;
}

async function startGame(page: Page) {
  await page.route('**fonts.googleapis.com**', (route) => route.abort());
  await page.route('**fonts.gstatic.com**', (route) => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btn-start');
  await page.waitForFunction(() => Boolean((window as unknown as { __game?: unknown }).__game), null, {
    polling: 100,
    timeout: 45_000,
  });
  await page.locator('#btn-start').dispatchEvent('click');
  await expect(page.locator('#hud')).toBeVisible({ timeout: 15_000 });
}

test.describe('Exploration UX adjustments', () => {
  test.setTimeout(90_000);

  test('entering a new terrain/biome has no visual banner while still tracking visited biomes', async ({ page }) => {
    await startGame(page);

    expect(await page.locator('#region-banner').count()).toBe(0);

    // Move into northern snow biome and deterministically step >0.75s of region tracking
    const visitedSnow = await page.evaluate(() => {
      const g = (window as unknown as { __game: DevGame }).__game;
      g.snapAt(-14, -222, 0, 0.28, 0.39);
      g.stepSystems(60, 1 / 60);
      return g.visitedBiomes.has(5);
    });
    expect(visitedSnow).toBe(true);
    expect(await page.locator('#region-banner').count()).toBe(0);
  });

  test('gliding wind volume is scaled to 70% of baseline wind formula', async ({ page }) => {
    await startGame(page);

    const check = await page.evaluate(async () => {
      const mod = await import('/src/audio.ts');
      const gust = 0.6;
      const highFactor = 0.9;
      const speed = 1.0;
      const glide = 0.72;
      const windMod = 1.0;
      const rawCap = Math.min(
        0.26,
        (0.042 + gust * 0.045 + highFactor * 0.04 + speed * 0.018 + glide * 0.11) * windMod,
      );
      const glidingVol = mod.computeBreezeVolume(gust, highFactor, speed, glide, windMod);
      const walkingRaw = Math.min(
        0.26,
        (0.042 + gust * 0.045 + highFactor * 0.04 + speed * 0.018) * windMod,
      );
      const walkingVol = mod.computeBreezeVolume(gust, highFactor, speed, 0, windMod);
      return {
        scale: mod.GLIDE_WIND_VOLUME_SCALE,
        ratio: glidingVol / rawCap,
        walkingDiff: Math.abs(walkingVol - walkingRaw),
      };
    });

    expect(check.scale).toBeCloseTo(0.7, 5);
    expect(check.ratio).toBeCloseTo(0.7, 5);
    expect(check.walkingDiff).toBeLessThan(1e-6);
  });

  test('minimap renders explorer position & facing direction and supports regional zoom and pan', async ({ page }) => {
    await startGame(page);

    // Position player cleanly at a known open spot facing North (Math.PI), then open map
    await page.evaluate(() => {
      const g = (window as unknown as { __game: DevGame }).__game;
      g.snapAt(10, 70, 0, 0.25, 0.39);
      g.player.facing = Math.PI; // North
      g.openMap();
      g.stepSystems(1, 1 / 60);
    });
    await expect(page.locator('#map-overlay')).toBeVisible();

    // Initial view is full island (zoom 1), zoom-out disabled
    const initialView = await page.evaluate(() => {
      const g = (window as unknown as { __game: DevGame }).__game;
      return g.gameMap.getView();
    });
    expect(initialView.zoom).toBeCloseTo(1, 2);
    await expect(page.locator('#btn-map-zoom-out')).toBeDisabled();

    // Activate locate/regional button to zoom smoothly into regional detail around player
    await page.locator('#btn-map-locate').dispatchEvent('pointerdown');
    const zoomedView = await page.evaluate(() => {
      const g = (window as unknown as { __game: DevGame }).__game;
      g.stepSystems(45, 1 / 60);
      return { view: g.gameMap.getView(), target: g.gameMap.getTargetView() };
    });
    expect(zoomedView.target.zoom).toBeGreaterThanOrEqual(2.4);
    expect(zoomedView.view.zoom).toBeGreaterThan(2.4);
    expect(Math.abs(zoomedView.target.centerX - 10)).toBeLessThan(2);
    expect(Math.abs(zoomedView.target.centerZ - 70)).toBeLessThan(2);
    await expect(page.locator('#btn-map-zoom-out')).toBeEnabled();

    // Verify facing direction renders visibly on canvas: North tip is north of player center, South tip is south
    const sampleArrowBalance = async () => {
      return page.evaluate(() => {
        const g = (window as unknown as { __game: DevGame }).__game;
        const cv = document.getElementById('map-canvas') as HTMLCanvasElement;
        const ctx = cv.getContext('2d')!;
        const [px, py] = g.gameMap.worldToCanvas(g.player.pos.x, g.player.pos.z, cv.width);
        const offset = Math.round(cv.width * 0.017);
        const countWarm = (cx: number, cy: number) => {
          const r = Math.max(2, Math.round(cv.width * 0.009));
          const data = ctx.getImageData(Math.round(cx - r), Math.round(cy - r), r * 2, r * 2).data;
          let hits = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i] > 195 && data[i] - data[i + 2] > 90) hits++;
          }
          return hits;
        };
        return {
          northHits: countWarm(px, py - offset),
          southHits: countWarm(px, py + offset),
        };
      });
    };

    const northSample = await sampleArrowBalance();
    expect(northSample.northHits).toBeGreaterThan(northSample.southHits);

    await page.evaluate(() => {
      const g = (window as unknown as { __game: DevGame }).__game;
      g.player.facing = 0; // South
      g.setYaw(Math.PI);
      g.stepSystems(2, 1 / 60);
    });

    const southSample = await sampleArrowBalance();
    expect(southSample.southHits).toBeGreaterThan(southSample.northHits);

    // Drag to pan while zoomed in
    const box = (await page.locator('#map-canvas').boundingBox())!;
    const cx = box.x + box.width * 0.5;
    const cy = box.y + box.height * 0.5;
    await page.evaluate(({ x0, y0, x1, y1 }) => {
      const cv = document.getElementById('map-canvas')!;
      cv.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: x0, clientY: y0, bubbles: true, cancelable: true }));
      cv.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: x1, clientY: y1, bubbles: true, cancelable: true }));
      cv.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: x1, clientY: y1, bubbles: true, cancelable: true }));
    }, { x0: cx, y0: cy, x1: cx - 60, y1: cy - 40 });

    const pannedView = await page.evaluate(() => {
      const g = (window as unknown as { __game: DevGame }).__game;
      g.stepSystems(2, 1 / 60);
      return g.gameMap.getView();
    });
    expect(Math.hypot(pannedView.centerX - zoomedView.view.centerX, pannedView.centerZ - zoomedView.view.centerZ)).toBeGreaterThan(10);

    // Zoom back out to full view
    await page.locator('#btn-map-zoom-out').dispatchEvent('pointerdown');
    await page.evaluate(() => { (window as unknown as { __game: DevGame }).__game.stepSystems(2, 1 / 60); });
    await page.locator('#btn-map-zoom-out').dispatchEvent('pointerdown');

    const resetView = await page.evaluate(() => {
      const g = (window as unknown as { __game: DevGame }).__game;
      g.stepSystems(50, 1 / 60);
      return { view: g.gameMap.getView(), scale: window.visualViewport?.scale ?? 1 };
    });
    expect(resetView.view.zoom).toBeCloseTo(1, 1);
    expect(resetView.scale).toBe(1);
  });

  test('Wonder first-sight triggers a single brief camera zoom pulse and never repeats nearby; Shrines do not pull camera', async ({ page }) => {
    await startGame(page);

    // Baseline far from any Wonder, facing away (South)
    const baseline = await page.evaluate(() => {
      const g = (window as unknown as { __game: DevGame }).__game;
      g.snapAt(10, 70, Math.PI, 0.25, 0.39);
      g.stepSystems(60, 1 / 60);
      return {
        poi: g.getPoiFocus(),
        fov: g.getFov(),
        baseFov: g.getBaseFov(),
        cssPoi: parseFloat(getComputedStyle(document.getElementById('poi-focus')!).getPropertyValue('--poi') || '0'),
      };
    });
    expect(baseline.poi.focus).toBeLessThan(0.05);
    expect(Math.abs(baseline.fov - baseline.baseFov)).toBeLessThan(1.5);

    // Approaching & discovering Shrine #0 (x:0, z:-95) should NOT trigger camera zoom or #poi-focus
    const nearShrine = await page.evaluate(() => {
      const g = (window as unknown as { __game: DevGame }).__game;
      g.snapAt(0, -81, 0, 0.22, 0.39);
      g.stepDiscovery(0.3);
      g.stepSystems(65, 1 / 60);
      return {
        discovered: g.towers[0].discovered,
        poi: g.getPoiFocus(),
        fov: g.getFov(),
        baseFov: g.getBaseFov(),
        cssPoi: parseFloat(getComputedStyle(document.getElementById('poi-focus')!).getPropertyValue('--poi') || '0'),
      };
    });
    expect(nearShrine.discovered).toBe(true);
    expect(nearShrine.poi.kind).toBe('none');
    expect(nearShrine.poi.focus).toBeLessThan(0.02);
    expect(Math.abs(nearShrine.fov - nearShrine.baseFov)).toBeLessThan(1.5);
    expect(nearShrine.cssPoi).toBeLessThan(0.02);

    // First-time sighting of Sakura Wonder (x:-36, z:22) triggers the one-time zoom & framing pulse
    const firstSightPeak = await page.evaluate(() => {
      const g = (window as unknown as { __game: DevGame }).__game;
      const sakura = g.wonders.find((w) => w.def.id === 'sakura')!;
      sakura.discovered = false;
      g.snapAt(-36, 46, 0, 0.22, 0.39);
      g.stepDiscovery(0.3);
      // Step ~2.0s to the peak of the ~4.0s pulse
      g.stepSystems(120, 1 / 60);
      return {
        discovered: sakura.discovered,
        poi: g.getPoiFocus(),
        fov: g.getFov(),
        baseFov: g.getBaseFov(),
        cssPoi: parseFloat(getComputedStyle(document.getElementById('poi-focus')!).getPropertyValue('--poi') || '0'),
      };
    });
    expect(firstSightPeak.discovered).toBe(true);
    expect(firstSightPeak.poi.kind).toBe('wonder');
    expect(firstSightPeak.poi.focus).toBeGreaterThan(0.75);
    expect(firstSightPeak.fov).toBeLessThan(firstSightPeak.baseFov - 6);
    expect(firstSightPeak.cssPoi).toBeGreaterThan(0.75);

    // After the ~4s pulse completes and settles (~6s total), emphasis returns to zero even right next to the Wonder
    const afterPulse = await page.evaluate(() => {
      const g = (window as unknown as { __game: DevGame }).__game;
      g.stepSystems(240, 1 / 60);
      return {
        poi: g.getPoiFocus(),
        fov: g.getFov(),
        baseFov: g.getBaseFov(),
        cssPoi: parseFloat(getComputedStyle(document.getElementById('poi-focus')!).getPropertyValue('--poi') || '0'),
      };
    });
    expect(afterPulse.poi.kind).toBe('none');
    expect(afterPulse.poi.focus).toBe(0);
    expect(Math.abs(afterPulse.fov - afterPulse.baseFov)).toBeLessThan(1.0);
    expect(afterPulse.cssPoi).toBe(0);

    // Moving around near / re-approaching the already-discovered Wonder NEVER triggers camera pull again
    const revisit = await page.evaluate(() => {
      const g = (window as unknown as { __game: DevGame }).__game;
      g.snapAt(-30, 40, 0.25, 0.2, 0.39);
      g.stepDiscovery(0.3);
      g.stepSystems(120, 1 / 60);
      return {
        poi: g.getPoiFocus(),
        fov: g.getFov(),
        baseFov: g.getBaseFov(),
        cssPoi: parseFloat(getComputedStyle(document.getElementById('poi-focus')!).getPropertyValue('--poi') || '0'),
      };
    });
    expect(revisit.poi.kind).toBe('none');
    expect(revisit.poi.focus).toBe(0);
    expect(Math.abs(revisit.fov - revisit.baseFov)).toBeLessThan(1.0);
    expect(revisit.cssPoi).toBe(0);
  });
});
