import { test, expect, type Page } from '@playwright/test';

interface DevOrbSystem {
  defs: { x: number; y: number; z: number; kind: string }[];
  visibility: Float32Array;
  hidden: boolean[];
  collected: boolean[];
}

interface DevRing {
  p: { x: number; y: number; z: number };
  mesh: { visible: boolean };
  unfold: number;
}

interface DevCourse {
  id: number;
  name: string;
  anchor: { x: number; y: number; z: number };
  start: { x: number; y: number; z: number };
  rings: DevRing[];
  revealed: boolean;
  discovered: boolean;
  done: boolean;
  next: number;
}

interface DevGame {
  player: { pos: { x: number; y: number; z: number } };
  orbs: DevOrbSystem;
  courses: DevCourse[];
  snapAt: (x: number, z: number, yaw: number, pitch: number, tod: number) => void;
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

test.describe('Spirit orb proximity visibility and wind trial sequential reveal', () => {
  test.setTimeout(90_000);

  test('spirit orbs stay invisible beyond 56m in 3D and smoothly appear as the player approaches', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    });

    await startGame(page);

    const report = await page.evaluate(() => {
      const g = (window as unknown as { __game: DevGame }).__game;
      g.snapAt(10, 70, 0, 0.14, 0.39);
      g.stepSystems(2, 1 / 60);

      const cx = g.player.pos.x;
      const cy = g.player.pos.y + 1.0;
      const cz = g.player.pos.z;

      let nearChecked = 0;
      let midChecked = 0;
      let farChecked = 0;
      let badFar = 0;
      let badNear = 0;
      let badMid = 0;

      for (let i = 0; i < g.orbs.defs.length; i++) {
        if (g.orbs.hidden[i] || g.orbs.collected[i]) continue;
        const d = g.orbs.defs[i];
        const dist3d = Math.hypot(cx - d.x, cy - d.y, cz - d.z);
        const vis = g.orbs.visibility[i];
        if (dist3d >= 56.5) {
          farChecked++;
          if (vis !== 0) badFar++;
        } else if (dist3d <= 31.5) {
          nearChecked++;
          if (vis < 0.99) badNear++;
        } else if (dist3d > 35 && dist3d < 53) {
          midChecked++;
          if (!(vis > 0 && vis < 1)) badMid++;
        }
      }

      // Also verify 3D distance applies identically to high sky orbs directly above an updraft
      const skyIdx = g.orbs.defs.findIndex((d) => d.kind === 'sky' && !g.orbs.hidden[g.orbs.defs.indexOf(d)]);
      const skyDef = g.orbs.defs[skyIdx];
      // Stand directly underneath the sky orb: horizontal dist ~ 0, vertical dist ~ 45m -> mid visibility (not full 1.0)
      g.snapAt(skyDef.x, skyDef.z, 0, 0.14, 0.39);
      g.stepSystems(2, 1 / 60);
      const skyUnderDist3d = Math.hypot(
        g.player.pos.x - skyDef.x,
        g.player.pos.y + 1.0 - skyDef.y,
        g.player.pos.z - skyDef.z,
      );
      const skyUnderVis = g.orbs.visibility[skyIdx];

      return {
        nearChecked,
        midChecked,
        farChecked,
        badFar,
        badNear,
        badMid,
        skyUnderDist3d,
        skyUnderVis,
      };
    });

    expect(report.nearChecked).toBeGreaterThan(0);
    expect(report.midChecked).toBeGreaterThan(0);
    expect(report.farChecked).toBeGreaterThan(10);
    expect(report.badFar).toBe(0);
    expect(report.badNear).toBe(0);
    expect(report.badMid).toBe(0);
    expect(report.skyUnderDist3d).toBeGreaterThan(33);
    expect(report.skyUnderVis).toBeLessThan(1);
    expect(errors).toEqual([]);
  });

  test('wind trial rings stay hidden from afar, unfold sequentially from ring 0 on approaching the summit cue, retract when leaving, and gate compass visibility', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    });

    await startGame(page);

    const flow = await page.evaluate(() => {
      const g = (window as unknown as { __game: DevGame }).__game;
      const c = g.courses[g.courses.length - 1]; // Nearest summit trial to start meadow

      // 1. From START_POS (~58m away), all trial rings and compass trial markers are hidden
      g.snapAt(10, 70, 0, 0.14, 0.39);
      g.stepSystems(10, 1 / 60);
      const farState = {
        anyRingVisible: g.courses.some((course) => course.rings.some((r) => r.mesh.visible)),
        anyRevealed: g.courses.some((course) => course.revealed),
        anyDiscovered: g.courses.some((course) => course.discovered),
        maxCompassTrialOpacity: Math.max(
          ...Array.from(document.querySelectorAll<HTMLElement>('.c-trial')).map((el) => parseFloat(el.style.opacity || '0')),
        ),
      };

      // 2. Approach the summit wind-glyph anchor (within 18m) facing toward ring 0
      const yawToRing0 = Math.atan2(-(c.start.x - c.anchor.x), -(c.start.z - c.anchor.z));
      g.snapAt(c.anchor.x, c.anchor.z, yawToRing0, 0.12, 0.39);
      g.stepSystems(1, 1 / 60);
      const onTrigger = {
        revealed: c.revealed,
        discovered: c.discovered,
        ringsVisibleImmediately: c.rings.filter((r) => r.mesh.visible).length,
      };

      // 3. Step ~0.55s: ring 0 has begun unfolding while trailing rings (5..7) are still hidden
      g.stepSystems(33, 1 / 60);
      const earlyUnfold = {
        ring0Visible: c.rings[0].mesh.visible,
        ring0Unfold: c.rings[0].unfold,
        ring6Visible: c.rings[6].mesh.visible,
        ring7Visible: c.rings[7].mesh.visible,
      };

      // 4. Step ~2.4s more: all rings finish unfolding in sequence
      g.stepSystems(144, 1 / 60);
      const fullUnfold = {
        allVisible: c.rings.every((r) => r.mesh.visible),
        minUnfold: Math.min(...c.rings.map((r) => r.unfold)),
      };

      // 5. Walk away (> 42m from summit anchor and ring 0) without starting -> rings retract, compass remembers trial
      const awayX = c.anchor.x + 65;
      const awayZ = c.anchor.z + 45;
      const yawBackToAnchor = Math.atan2(-(c.anchor.x - awayX), -(c.anchor.z - awayZ));
      g.snapAt(awayX, awayZ, yawBackToAnchor, 0.14, 0.39);
      g.stepSystems(60, 1 / 60); // 1.0s > 0.55s retract duration
      const afterLeave = {
        revealed: c.revealed,
        discovered: c.discovered,
        anyRingVisible: c.rings.some((r) => r.mesh.visible),
        maxRingUnfold: Math.max(...c.rings.map((r) => r.unfold)),
        compassOpacityWhenFacingBack: parseFloat(
          document.querySelectorAll<HTMLElement>('.c-trial')[c.id]?.style.opacity || '0',
        ),
      };

      return { farState, onTrigger, earlyUnfold, fullUnfold, afterLeave };
    });

    // Far away: completely hidden
    expect(flow.farState.anyRingVisible).toBe(false);
    expect(flow.farState.anyRevealed).toBe(false);
    expect(flow.farState.anyDiscovered).toBe(false);
    expect(flow.farState.maxCompassTrialOpacity).toBe(0);

    // Trigger at summit wind-glyph: revealed & discovered, rings unfold sequentially after butterfly swoop
    expect(flow.onTrigger.revealed).toBe(true);
    expect(flow.onTrigger.discovered).toBe(true);
    expect(flow.onTrigger.ringsVisibleImmediately).toBe(0);

    // Early unfold: ring 0 appears first while far rings are still folded
    expect(flow.earlyUnfold.ring0Visible).toBe(true);
    expect(flow.earlyUnfold.ring0Unfold).toBeGreaterThan(0.1);
    expect(flow.earlyUnfold.ring6Visible).toBe(false);
    expect(flow.earlyUnfold.ring7Visible).toBe(false);

    // Full unfold: all 8 rings open
    expect(flow.fullUnfold.allVisible).toBe(true);
    expect(flow.fullUnfold.minUnfold).toBeGreaterThan(0.95);

    // Leaving without starting: rings smoothly retract while compass retains discovered trial
    expect(flow.afterLeave.revealed).toBe(false);
    expect(flow.afterLeave.discovered).toBe(true);
    expect(flow.afterLeave.anyRingVisible).toBe(false);
    expect(flow.afterLeave.maxRingUnfold).toBe(0);
    expect(flow.afterLeave.compassOpacityWhenFacingBack).toBeGreaterThan(0.4);

    expect(errors).toEqual([]);
  });
});
