#!/usr/bin/env node
/**
 * Real-Chromium WebGL2 verification script (F6 / OpenSpec task 4.2):
 * 1. Launches a local Vite dev server for `editor/`.
 * 2. Runs `runWebGL2ParitySuite()` comparing WebGL2SheetComposer
 *    against the Canvas 2D FrameComposer oracle across all 6 tools, 15 W3C blend
 *    modes, flat coats, erasers, onion skin, lasso, pipette, tile isolation,
 *    boundary crossing, subpixel hairlines/feathers, and minified blends.
 * 3. Mounts the real studio (`CanvasView.svelte`) with a controlled hardware-GPU
 *    stub, starts a captured pointer stroke, injects `webglcontextlost` MID-STROKE,
 *    asserts Canvas 2D takes over live without breaking pointer capture, injects
 *    `webglcontextrestored` while still dragging (verifying deferred swap), releases
 *    the stroke, and asserts both stroke commit AND automatic WebGL2 restoration.
 *
 * Pass --gecko-round-turns to check just the stroke regressions on an affected
 * Firefox with accelerated Canvas2D. This mode requires a display (or Xvfb).
 */

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const editorDir = path.resolve(__dirname, '..');
const PORT = 4174;
const URL = `http://localhost:${PORT}/`;
const gecko = process.argv.includes('--gecko-round-turns');
const SESSION = gecko ? 'verify-gecko-round-turns' : 'verify-webgl2';

function pw(...args) {
  return execFileSync('playwright-cli', [`-s=${SESSION}`, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitForServer(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Wait for Vite to finish booting.
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for dev server at ${url}`);
}

const vite = spawn('bunx', ['--bun', 'vite', '--port', String(PORT), '--strictPort'], {
  cwd: editorDir,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let firefoxConfigDir;
try {
  await waitForServer(URL);

  if (gecko) {
    firefoxConfigDir = mkdtempSync(path.join(tmpdir(), 'toonop-gecko-round-turns-'));
    const config = path.join(firefoxConfigDir, 'playwright.json');
    writeFileSync(config, JSON.stringify({
      browser: {
        browserName: 'firefox',
        launchOptions: {
          firefoxUserPrefs: {
            'gfx.canvas.accelerated': true,
            'gfx.canvas.accelerated.force-enabled': true,
            'gfx.canvas.accelerated.min-size': 1,
            'gfx.webrender.all': true,
            'webgl.force-enabled': true,
          },
        },
      },
    }));
    pw('open', URL, '--browser=firefox', '--headed', `--config=${config}`);
  } else {
    pw('open', URL);
  }

  // Suite A: Real WebGL2 pixel-parity suite, including playback transitions.
  const parityScript = `async page => {
    return page.evaluate(async (gecko) => {
      if (gecko) {
        // Confirm this browser actually exhibits the accelerated Canvas2D bug.
        // A software context would pass the stroke checks even without the fix.
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext('2d', { willReadFrequently: false });
        ctx.lineWidth = 60;
        ctx.lineCap = ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(900, 450);
        ctx.quadraticCurveTo(900, 200, 899, 201);
        ctx.stroke();
        const clipped = ctx.getImageData(899, 180, 1, 1).data[3] === 0;
        canvas.width = canvas.height = 0;
        if (!clipped) throw new Error('This check requires a Gecko build that reproduces the accelerated Canvas2D round-turn bug');
      }
      const m = await import('/src/lib/render/webgl/parity.ts');
      const report = m.runWebGL2ParitySuite();
      const cases = gecko ? report.results.filter(r => /^wide-(quadratic|cubic)-round-/.test(r.name)) : report.results;
      if (cases.length === 0) throw new Error('No round-turn cases ran: ' + JSON.stringify(report.results));
      return { renderer: report.renderer, total: cases.length, failed: cases.filter(r => !r.pass) };
    }, ${gecko});
  }`;
  const parityOut = pw('--raw', 'run-code', parityScript).trim();
  const parity = JSON.parse(parityOut);
  if (parity.failed.length > 0) {
    throw new Error(`Parity suite failed (${parity.failed.length}/${parity.total}): ${JSON.stringify(parity.failed)}`);
  }
  console.log(`PASS Suite A (pixel parity): ${parity.total}/${parity.total} cases passed on ${parity.renderer}`);
  if (!gecko) verifyStudioLifecycle();
} finally {
  try { pw('close'); } catch { /* already closed */ }
  vite.kill('SIGTERM');
  if (firefoxConfigDir) rmSync(firefoxConfigDir, { recursive: true, force: true });
}

// Suite B: Live CanvasView mid-stroke context loss + Canvas 2D fallback + deferred restore.
function verifyStudioLifecycle() {
  const lifecycleScript = `async page => {
    // Harness-only initScript so headless SwiftShader promotes as a studio GPU context
    // and exposes the live studio WebGL2 context + WEBGL_lose_context extension.
    await page.addInitScript(() => {
      localStorage.setItem('toon-editor:ui', JSON.stringify({
        preset: 'toonop',
        tourDone: true,
        settings: { hardwareRender: true, showDraftsOnStart: false },
      }));
      const origGetContext = HTMLCanvasElement.prototype.getContext;
      window.__STUDIO_GL__ = null;
      window.__STUDIO_LOSE_EXT__ = null;
      HTMLCanvasElement.prototype.getContext = function(type, attrs) {
        const ctx = origGetContext.call(this, type, attrs);
        if (type === 'webgl2' && ctx && attrs && attrs.failIfMajorPerformanceCaveat) {
          const origGetExt = ctx.getExtension.bind(ctx);
          const origGetParam = ctx.getParameter.bind(ctx);
          const FAKE_INFO = { UNMASKED_RENDERER_WEBGL: 0x9246, UNMASKED_VENDOR_WEBGL: 0x9245 };
          ctx.getExtension = (name) => name === 'WEBGL_debug_renderer_info' ? FAKE_INFO : origGetExt(name);
          ctx.getParameter = (p) => {
            if (p === 0x9246 || p === ctx.RENDERER) return 'Harness Hardware GPU';
            return origGetParam(p);
          };
          window.__STUDIO_GL__ = ctx;
          window.__STUDIO_LOSE_EXT__ = origGetExt('WEBGL_lose_context');
        }
        return ctx;
      };
    });

    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto('${URL}', { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);

    // Dismiss New Cartoon hub if open (pick the first format preset card or close button).
    const hub = page.locator('dialog.hub[open]');
    if (await hub.isVisible().catch(() => false)) {
      const preset = hub.locator('button.card, button[data-preset]').first();
      if (await preset.isVisible().catch(() => false)) {
        await preset.click();
      } else {
        await hub.locator('button').nth(1).click();
      }
      await page.waitForTimeout(200);
    }
    const skip = page.getByRole('button', { name: 'Пропустить' });
    if (await skip.isVisible().catch(() => false)) {
      await skip.click();
      await page.waitForTimeout(100);
    }

    const inspectStage = () => page.evaluate(() => {
      const stage = document.querySelector('div.stage[role="img"]');
      const canvases = stage ? [...stage.querySelectorAll('canvas')] : [];
      const c2d = canvases[0];
      const cgl = canvases[1];
      const countDarkInk = (xFrac0, xFrac1) => {
        if (!c2d || c2d.width <= 0 || c2d.height <= 0) return 0;
        const ctx = c2d.getContext('2d');
        if (!ctx) return 0;
        const x0 = Math.max(0, Math.floor(c2d.width * xFrac0));
        const x1 = Math.min(c2d.width, Math.ceil(c2d.width * xFrac1));
        const w = x1 - x0;
        if (w <= 0) return 0;
        const d = ctx.getImageData(x0, 0, w, c2d.height).data;
        let dark = 0;
        for (let i = 0; i < d.length; i += 4) {
          // Dark stroke ink (not white paper 255,255,255 and not transparent table a=0).
          if (d[i + 3] > 200 && d[i] < 120 && d[i + 1] < 120 && d[i + 2] < 120) dark++;
        }
        return dark;
      };
      const pid = window.__CAPTURED_POINTER_ID__;
      return {
        hasGl: Boolean(window.__STUDIO_GL__),
        hasLoseExt: Boolean(window.__STUDIO_LOSE_EXT__),
        c2dHidden: c2d ? c2d.classList.contains('hidden') : null,
        glHidden: cgl ? cgl.classList.contains('hidden') : null,
        hasCapture: stage && pid !== null ? stage.hasPointerCapture(pid) : false,
        lostCaptureCount: window.__LOST_CAPTURE_COUNT__ ?? 0,
        preLossInk: countDarkInk(0.28, 0.46),
        postLossInk: countDarkInk(0.54, 0.72),
      };
    });

    // Attach pointer capture instrumentation on the permanent stage element.
    await page.evaluate(() => {
      window.__CAPTURED_POINTER_ID__ = null;
      window.__LOST_CAPTURE_COUNT__ = 0;
      const stage = document.querySelector('div.stage[role="img"]');
      stage.addEventListener('pointerdown', (e) => { window.__CAPTURED_POINTER_ID__ = e.pointerId; }, true);
      stage.addEventListener('lostpointercapture', () => { window.__LOST_CAPTURE_COUNT__ += 1; });
    });

    const beforeStroke = await inspectStage();
    const undoBtn = page.getByRole('button', { name: 'Отменить', exact: true });

    // Begin captured pointer stroke on stage (left-of-center segment: 0.30 -> 0.44).
    const stage = page.locator('div.stage[role="img"]');
    const box = await stage.boundingBox();
    await page.mouse.move(box.x + box.width * 0.30, box.y + box.height * 0.48);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.44, box.y + box.height * 0.50, { steps: 4 });

    // Lose WebGL2 context MID-STROKE!
    await page.evaluate(() => window.__STUDIO_LOSE_EXT__.loseContext());
    await page.waitForTimeout(120);
    const duringLossMidStroke = await inspectStage();
    const undoDuringLoss = await undoBtn.isEnabled();

    // Keep dragging the SAME captured stroke into the post-loss region (0.44 -> 0.70).
    await page.mouse.move(box.x + box.width * 0.70, box.y + box.height * 0.52, { steps: 6 });
    await page.waitForTimeout(100);
    const afterPostLossMove = await inspectStage();
    const undoBeforeUp = await undoBtn.isEnabled();

    // Restore WebGL2 context WHILE STILL DRAGGING: must wait until pointerup!
    await page.evaluate(() => window.__STUDIO_LOSE_EXT__.restoreContext());
    await page.waitForTimeout(120);
    const restoredWhileStillDragging = await inspectStage();

    // Release pointer: stroke commits AND WebGL2 returns automatically!
    await page.mouse.up();
    await page.waitForTimeout(250);
    const afterStrokeSettled = await inspectStage();
    const undoAfterUp = await undoBtn.isEnabled();

    // Verify the COMMITTED document stroke itself contains post-loss geometry by
    // toggling hardware render off in Settings and reading the committed Canvas 2D frame.
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await page.getByRole('tab', { name: 'Вид', exact: true }).click();
    const hwCb = page.locator('label', { hasText: 'Аппаратное ускорение' }).locator('input[type=checkbox]');
    await hwCb.click();
    await page.waitForTimeout(150);
    const committedOnCanvas2D = await inspectStage();

    return {
      beforeStroke,
      duringLossMidStroke,
      undoDuringLoss,
      afterPostLossMove,
      undoBeforeUp,
      restoredWhileStillDragging,
      afterStrokeSettled,
      undoAfterUp,
      committedOnCanvas2D,
      pageErrors,
    };
  }`;
  const lifeOut = pw('--raw', 'run-code', lifecycleScript).trim();
  const life = JSON.parse(lifeOut);

  const checks = [
    ['WebGL2 active before stroke', life.beforeStroke.hasGl && life.beforeStroke.glHidden === false],
    ['Stage retains pointer capture across context loss', life.duringLossMidStroke.hasCapture === true && life.duringLossMidStroke.lostCaptureCount === 0],
    ['Canvas 2D paints live pre-loss stroke ink on fallback', life.duringLossMidStroke.glHidden === true && life.duringLossMidStroke.preLossInk > 0 && life.duringLossMidStroke.postLossInk === 0],
    ['No premature stroke commit before pointerup', life.undoDuringLoss === false && life.undoBeforeUp === false],
    ['Stroke continues painting into post-loss region while captured', life.afterPostLossMove.hasCapture === true && life.afterPostLossMove.lostCaptureCount === 0 && life.afterPostLossMove.postLossInk > 0],
    ['WebGL2 restore deferred while still dragging', life.restoredWhileStillDragging.glHidden === true && life.restoredWhileStillDragging.hasCapture === true],
    ['Captured stroke committed on pointerup', life.undoAfterUp === true],
    ['WebGL2 restored automatically after gesture settled', life.afterStrokeSettled.glHidden === false],
    ['Committed document stroke contains both pre-loss and post-loss ink', life.committedOnCanvas2D.preLossInk > 0 && life.committedOnCanvas2D.postLossInk > 0],
    ['Zero uncaught page errors', life.pageErrors.length === 0],
  ];
  const bad = checks.filter(([, ok]) => !ok);
  if (bad.length > 0) {
    throw new Error(`Lifecycle checks failed: ${JSON.stringify(bad)}\nDetail: ${JSON.stringify(life, null, 2)}`);
  }
  console.log('PASS Suite B (live CanvasView mid-stroke context loss & restore):', JSON.stringify(life));
}
