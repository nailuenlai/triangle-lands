import { test, expect, type Page } from '@playwright/test';

async function startGame(page: Page) {
  // Abort external Google Fonts requests so tests run fast and offline-safe
  await page.route('**fonts.googleapis.com**', (route) => route.abort());
  await page.route('**fonts.gstatic.com**', (route) => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btn-start');
  await page.locator('#btn-start').tap();
  await expect(page.locator('#hud')).toBeVisible();
  await page.waitForTimeout(300);
}

test.describe('Touch zoom prevention during gameplay', () => {
  test('all interactive HUD buttons and their SVG children disable browser touch gestures via touch-action: none', async ({ page }) => {
    await startGame(page);

    const touchActions = await page.evaluate(() => {
      const selectors = [
        'html',
        'body',
        '#touch-layer',
        '#hud',
        '#btn-jump',
        '#btn-jump svg',
        '#btn-sprint',
        '#btn-interact',
        '#btn-map',
        '#btn-audio',
      ];
      return Object.fromEntries(
        selectors.map((sel) => {
          const el = document.querySelector(sel);
          return [sel, el ? getComputedStyle(el).touchAction : null];
        }),
      );
    });

    for (const [sel, value] of Object.entries(touchActions)) {
      expect(value, `${sel} should have touch-action: none`).toBe('none');
    }
  });

  test('Safari gesturestart/gesturechange and dblclick on jump button are canceled', async ({ page }) => {
    await startGame(page);

    const results = await page.evaluate(() => {
      const btn = document.getElementById('btn-jump')!;
      const svg = btn.querySelector('svg')!;
      const dispatch = (target: EventTarget, type: string) => {
        const ev = new Event(type, { bubbles: true, cancelable: true });
        target.dispatchEvent(ev);
        return ev.defaultPrevented;
      };
      return {
        btnGestureStart: dispatch(btn, 'gesturestart'),
        btnGestureChange: dispatch(btn, 'gesturechange'),
        svgGestureStart: dispatch(svg, 'gesturestart'),
        btnDblClick: dispatch(btn, 'dblclick'),
        svgDblClick: dispatch(svg, 'dblclick'),
      };
    });

    expect(results.btnGestureStart).toBe(true);
    expect(results.btnGestureChange).toBe(true);
    expect(results.svgGestureStart).toBe(true);
    expect(results.btnDblClick).toBe(true);
    expect(results.svgDblClick).toBe(true);
  });

  test('holding left joystick forward while rapidly double-tapping jump prevents touch zoom and still jumps', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP multi-touch synthesis is Chromium-only');
    await startGame(page);

    const jumpBox = await page.locator('#btn-jump').boundingBox();
    expect(jumpBox).not.toBeNull();
    const jx = jumpBox!.x + jumpBox!.width / 2;
    const jy = jumpBox!.y + jumpBox!.height / 2;
    const lx = 85;
    let ly = 560;

    // Record defaultPrevented on touch events at window bubble phase
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__touchLog = [];
      for (const type of ['touchstart', 'touchmove', 'touchend']) {
        window.addEventListener(type, (e) => {
          const te = e as TouchEvent;
          const target = te.target as Element | null;
          ((window as unknown as Record<string, unknown>).__touchLog as unknown[]).push({
            type,
            onJump: !!target?.closest?.('#btn-jump'),
            touches: te.touches.length,
            defaultPrevented: te.defaultPrevented,
          });
        }, false);
      }
    });

    const startPos = await page.evaluate(() => window.__game!.player.pos.toArray());

    const cdp = await page.context().newCDPSession(page);

    // 1. Left thumb touches down and continuously drags forward
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: lx, y: ly, id: 1 }],
    });
    for (let i = 0; i < 6; i++) {
      ly -= 10;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: lx, y: ly, id: 1 }],
      });
      await page.waitForTimeout(16);
    }

    // 2. While left thumb keeps moving forward, rapidly tap jump twice
    for (let tap = 0; tap < 2; tap++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: jx, y: jy, id: 2 }],
      });
      for (let i = 0; i < 2; i++) {
        ly -= 6;
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            { x: lx, y: ly, id: 1 },
            { x: jx, y: jy, id: 2 },
          ],
        });
        await page.waitForTimeout(16);
      }
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [{ x: jx, y: jy, id: 2 }],
      });
      await page.waitForTimeout(60);
    }

    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [{ x: lx, y: ly, id: 1 }],
    });
    await page.waitForTimeout(150);

    const outcome = await page.evaluate(() => {
      const g = window.__game!;
      return {
        scale: window.visualViewport?.scale ?? 1,
        pos: g.player.pos.toArray(),
        mode: g.player.mode,
        touchLog: (window as unknown as { __touchLog: { type: string; onJump: boolean; touches: number; defaultPrevented: boolean }[] }).__touchLog,
      };
    });

    expect(outcome.scale).toBe(1);

    // Every touchstart/touchend on the jump button and every multi-touch event must be defaultPrevented
    const jumpTouchEvents = outcome.touchLog.filter((e) => e.onJump && (e.type === 'touchstart' || e.type === 'touchend'));
    expect(jumpTouchEvents.length).toBeGreaterThanOrEqual(4);
    for (const ev of jumpTouchEvents) {
      expect(ev.defaultPrevented, `expected ${ev.type} on #btn-jump to be defaultPrevented`).toBe(true);
    }

    const multiTouchEvents = outcome.touchLog.filter((e) => e.touches > 1);
    expect(multiTouchEvents.length).toBeGreaterThan(0);
    for (const ev of multiTouchEvents) {
      expect(ev.defaultPrevented, `expected multi-touch ${ev.type} to be defaultPrevented`).toBe(true);
    }

    // Player should still have moved and jumped cleanly
    const distXZ = Math.hypot(outcome.pos[0] - startPos[0], outcome.pos[2] - startPos[2]);
    expect(distXZ).toBeGreaterThan(0.2);
  });

  test('multi-touch gesture on jump button does not zoom viewport even when browser ignores user-scalable=no and body touch-action', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP multi-touch synthesis is Chromium-only');
    await startGame(page);

    // Simulate mobile browsers (e.g. iOS Safari 10+, Android Force-Enable-Zoom)
    // that ignore user-scalable=no / maximum-scale=1 and where html/body touch-action
    // does not shield fixed HUD buttons.
    await page.evaluate(() => {
      document.querySelector('meta[name="viewport"]')?.setAttribute('content', 'width=device-width, initial-scale=1');
      document.documentElement.style.touchAction = 'auto';
      document.body.style.touchAction = 'auto';
    });
    await page.waitForTimeout(100);

    const jumpBox = await page.locator('#btn-jump').boundingBox();
    expect(jumpBox).not.toBeNull();
    const jx = jumpBox!.x + jumpBox!.width / 2;
    const jy = jumpBox!.y + jumpBox!.height / 2;

    const cdp = await page.context().newCDPSession(page);

    // Two-finger spread starting at the bottom-right jump button
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: jx - 10, y: jy - 10, id: 1 }],
    });
    await page.waitForTimeout(16);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: jx + 10, y: jy + 10, id: 2 }],
    });
    for (let i = 1; i <= 14; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: jx - 10 - i * 10, y: jy - 10 - i * 10, id: 1 },
          { x: jx + 10 + i * 2, y: jy + 10 + i * 2, id: 2 },
        ],
      });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [
        { x: jx - 150, y: jy - 150, id: 1 },
        { x: jx + 38, y: jy + 38, id: 2 },
      ],
    });
    await page.waitForTimeout(300);

    const vv = await page.evaluate(() => ({
      scale: window.visualViewport?.scale ?? 1,
      offsetLeft: window.visualViewport?.offsetLeft ?? 0,
      offsetTop: window.visualViewport?.offsetTop ?? 0,
    }));

    expect(vv.scale).toBe(1);
    expect(vv.offsetLeft).toBe(0);
    expect(vv.offsetTop).toBe(0);
  });

  test('tapping jump button still triggers jump in gameplay', async ({ page }) => {
    await startGame(page);
    await page.locator('#btn-jump').tap();
    await expect.poll(async () => {
      return page.evaluate(() => window.__game!.player.mode);
    }, { timeout: 5_000 }).toBe('air');
  });
});
