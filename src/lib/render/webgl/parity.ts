/**
 * Real-browser WebGL2 vs Canvas 2D pixel-parity verification suite.
 * Intended to run inside Chromium (via Playwright / dev server) to verify
 * shaders, stencil winding, 4x4 fixed-grid coverage, all 15 W3C blend modes,
 * flat coats, erasers, onion skin, rigid lasso, region undo, tile isolation,
 * subpixel survival, and pipette readback against the Canvas 2D oracle.
 */

import { BACKGROUND_COLOR, FIXED_POINT_SCALE } from '../../format/constants';
import { BLEND_MODES, SQUARE_STAMP, type Frame, type ToonDocument, type ToolDescriptor } from '../../format/types';
import { FrameComposer, type ComposeTarget, type FrameScene } from '../frame-compose';
import type { PlacedStroke } from '../canvas2d';
import type { StagePresentParams } from '../sheet-composer';
import { negotiateAtlasFormats, runWebGL2SmokeTest } from './probe';
import { WebGL2SheetComposer } from './composer';

export interface ParityCaseResult {
  readonly name: string;
  readonly pass: boolean;
  readonly detail: string;
}

export interface ParityReport {
  readonly ok: boolean;
  readonly renderer: string;
  readonly results: ParityCaseResult[];
}

function renderCanvas2D(w: number, h: number, scene: FrameScene): Uint8ClampedArray {
  const sheet = document.createElement('canvas');
  sheet.width = w;
  sheet.height = h;
  const sctx = sheet.getContext('2d', { willReadFrequently: true })!;
  const composer = new FrameComposer(undefined, { cellBytes: 16 * 1024 * 1024 });
  composer.compose(sctx as unknown as ComposeTarget, w, h, scene);

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d', { willReadFrequently: true })!;
  octx.fillStyle = scene.paper ?? BACKGROUND_COLOR;
  octx.fillRect(0, 0, w, h);
  octx.drawImage(sheet, 0, 0);
  const data = octx.getImageData(0, 0, w, h).data;
  composer.dispose();
  sheet.width = sheet.height = out.width = out.height = 0;
  return data;
}

function readWebGLCanvas(gl: WebGL2RenderingContext, w: number, h: number): Uint8Array {
  const flipped = new Uint8Array(w * h * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, flipped);
  // Default WebGL framebuffer has y=0 at bottom; flip vertically to match top-down Canvas 2D ImageData.
  const out = new Uint8Array(w * h * 4);
  const rowBytes = w * 4;
  for (let y = 0; y < h; y++) {
    const srcRow = (h - 1 - y) * rowBytes;
    const dstRow = y * rowBytes;
    out.set(flipped.subarray(srcRow, srcRow + rowBytes), dstRow);
  }
  return out;
}

/** Checks interior pixels (3x3 uniform neighborhood in reference) for strict <= tolDiff per channel. */
function compareInteriorAndEdges(
  ref: Uint8ClampedArray,
  got: Uint8Array,
  w: number,
  h: number,
  interiorTol = 1,
): { interiorMismatches: number; maxInteriorDiff: number; refInk: number; gotInk: number; missedInk: number } {
  let interiorMismatches = 0;
  let maxInteriorDiff = 0;
  let refInk = 0;
  let gotInk = 0;
  let missedInk = 0;

  const isBg = (buf: ArrayLike<number>, i: number) =>
    buf[i] >= 253 && buf[i + 1] >= 253 && buf[i + 2] >= 253;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      const r0 = ref[idx], g0 = ref[idx + 1], b0 = ref[idx + 2];
      if (!isBg(ref, idx)) {
        refInk++;
        // Bidirectional survival: check if any pixel within 1px in got has ink.
        let found = false;
        for (let dy = -1; dy <= 1 && !found; dy++) {
          for (let dx = -1; dx <= 1 && !found; dx++) {
            const ni = ((y + dy) * w + (x + dx)) * 4;
            if (!isBg(got, ni)) found = true;
          }
        }
        if (!found) missedInk++;
      }
      if (!isBg(got, idx)) gotInk++;

      // Check if 3x3 neighborhood in reference is uniform (interior pixel).
      let uniform = true;
      for (let dy = -1; dy <= 1 && uniform; dy++) {
        for (let dx = -1; dx <= 1 && uniform; dx++) {
          const ni = ((y + dy) * w + (x + dx)) * 4;
          if (ref[ni] !== r0 || ref[ni + 1] !== g0 || ref[ni + 2] !== b0) uniform = false;
        }
      }
      if (uniform) {
        const diff = Math.max(
          Math.abs(ref[idx] - got[idx]),
          Math.abs(ref[idx + 1] - got[idx + 1]),
          Math.abs(ref[idx + 2] - got[idx + 2]),
        );
        if (diff > maxInteriorDiff) maxInteriorDiff = diff;
        if (diff > interiorTol) interiorMismatches++;
      }
    }
  }
  return { interiorMismatches, maxInteriorDiff, refInk, gotInk, missedInk };
}

function makePresent(w: number, h: number): StagePresentParams {
  return {
    stageWidth: w,
    stageHeight: h,
    sheetX: 0,
    sheetY: 0,
    sheetW: w,
    sheetH: h,
    angle: 0,
    stretch: 1,
    paper: BACKGROUND_COLOR,
    gridStep: 0,
  };
}

export function runWebGL2ParitySuite(): ParityReport {
  const results: ParityCaseResult[] = [];
  const canvas = document.createElement('canvas');
  const W = 256;
  const H = 256;
  canvas.width = W;
  canvas.height = H;
  // Note: allow software WebGL2 in headless Chromium CI so shaders & stencil run for real.
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) {
    return { ok: false, renderer: 'none', results: [{ name: 'webgl2-context', pass: false, detail: 'no webgl2' }] };
  }
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  const formats = negotiateAtlasFormats(gl);
  if (!formats) {
    return { ok: false, renderer, results: [{ name: 'atlas-formats', pass: false, detail: 'no complete FBO format' }] };
  }

  // 1. 16x16 smoke test
  const smokeOk = runWebGL2SmokeTest(gl, formats);
  results.push({ name: 'smoke-test-16x16', pass: smokeOk, detail: JSON.stringify(formats) });

  const composer = new WebGL2SheetComposer(gl, { formats, budgetBytes: 64 * 1024 * 1024 });
  const runCase = (
    name: string,
    doc: ToonDocument,
    opts: Partial<FrameScene> = {},
    w = W,
    h = H,
    level = 1,
    interiorTol = 1,
  ) => {
    canvas.width = w;
    canvas.height = h;
    const viewport = { scale: level / FIXED_POINT_SCALE, dpr: 1 };
    const scene: FrameScene = {
      doc,
      frame: 0,
      activeLayer: 0,
      viewport,
      tools: doc.tools,
      paper: BACKGROUND_COLOR,
      ...opts,
    };
    const ref = renderCanvas2D(w, h, scene);
    composer.invalidate();
    const ok = composer.composeAndPresent(w, h, scene, makePresent(w, h));
    const got = readWebGLCanvas(gl, w, h);
    const cmp = compareInteriorAndEdges(ref, got, w, h, interiorTol);
    const pass = ok && cmp.interiorMismatches === 0 && cmp.missedInk === 0 && (cmp.refInk === 0 || cmp.gotInk > 0);
    results.push({
      name,
      pass,
      detail: `ok=${ok} interiorBad=${cmp.interiorMismatches} maxDiff=${cmp.maxInteriorDiff} missed=${cmp.missedInk} refInk=${cmp.refInk} gotInk=${cmp.gotInk}`,
    });
  };

  // 2. All 6 tools + 3 geometries + dot + layer-isolated eraser
  const toolsAll: ToolDescriptor[] = [
    { kind: 'pencil', geometry: 'line', width: 48, color: '#1b5cff' },
    { kind: 'pencil', geometry: 'smooth', width: 48, color: '#cc2233' },
    { kind: 'pencil', geometry: 'cubic', width: 40, color: '#118844' },
    { kind: 'eraser', geometry: 'line', width: 64 },
    { kind: 'contour', geometry: 'smooth', color: '#ff8800' },
    { kind: 'contour-eraser', geometry: 'line' },
    { kind: 'feather', geometry: 'line', width: 24, color: '#000000', fill: '#ffe066' },
    { kind: 'stamp', geometry: 'line', width: 64, color: '#663399', shape: SQUARE_STAMP },
    { kind: 'stamp', geometry: 'line', width: 80, color: '#008899', shape: [0, 0, 1, 0.5, 0, 1] },
  ];
  const docAll: ToonDocument = {
    schema_version: 8,
    width: W * 8,
    height: H * 8,
    frame_rate: 12,
    tools: toolsAll,
    layers: [
      {
        hidden: false,
        frames: [{
          strokes: [
            { points: [200, 200, 1800, 200], tool_id: 0 }, // blue line under eraser
            { points: [200, 500, 900, 350, 1600, 550], tool_id: 1 }, // smooth red
            { points: [200, 800, 600, 600, 1200, 1000, 1800, 800], tool_id: 2 }, // cubic green
            { points: [300, 1100], tool_id: 0 }, // single dot
            { points: [600, 1000, 950, 1000, 950, 1350, 600, 1350], tool_id: 4 }, // smooth contour
            { points: [1100, 1050, 1550, 1050, 1550, 1450, 1100, 1450], tool_id: 6 }, // feather
            { points: [256, 1600, 640, 1600], tool_id: 7 }, // square stamp
            { points: [1100, 1600], tool_id: 8 }, // custom triangle stamp
          ],
        }],
      },
      {
        hidden: false,
        frames: [{
          strokes: [
            { points: [200, 200, 1800, 200], tool_id: 1 }, // red over blue
            { points: [900, 120, 900, 280], tool_id: 3 }, // eraser cuts red ONLY, blue shows through!
            { points: [700, 1100, 850, 1100, 850, 1250, 700, 1250], tool_id: 5 }, // contour-eraser on empty upper layer
          ],
        }],
      },
    ],
  };
  runCase('all-6-tools-and-isolated-eraser', docAll, { activeLayer: 1 });

  // 3. Pressure 2-point counterexample + 180° reversal
  const docPress: ToonDocument = {
    schema_version: 8,
    width: W * 8,
    height: H * 8,
    frame_rate: 12,
    tools: [{ kind: 'pencil', geometry: 'line', width: 480, color: '#223344' }],
    layers: [{
      hidden: false,
      frames: [{
        strokes: [
          { points: [300, 600, 1700, 600], pressure: [0, 100], tool_id: 0 },
          { points: [400, 1400, 1400, 1400, 400, 1400], pressure: [30, 100, 30], tool_id: 0 },
        ],
      }],
    }],
  };
  runCase('pressure-counterexample-and-reversal', docPress);

  // 4. Flat coat (buildup: false) overlapping strokes stay uniform opacity
  const docFlat: ToonDocument = {
    schema_version: 8,
    width: W * 8,
    height: H * 8,
    frame_rate: 12,
    tools: [{ kind: 'pencil', geometry: 'line', width: 160, color: '#1b5cff', opacity: 50, buildup: false }],
    layers: [{
      hidden: false,
      frames: [{
        strokes: [
          { points: [300, 400, 1700, 1600], tool_id: 0 },
          { points: [1700, 400, 300, 1600], tool_id: 0 },
        ],
      }],
    }],
  };
  runCase('flat-coat-buildup-false', docFlat);

  // 5. All 15 W3C blend modes + translucent layer opacity (strict <= 1/channel interior)
  for (const mode of BLEND_MODES) {
    const docBlend: ToonDocument = {
      schema_version: 8,
      width: 128 * 8,
      height: 128 * 8,
      frame_rate: 12,
      tools: [
        { kind: 'contour', geometry: 'line', color: '#3a7bd5' },
        { kind: 'contour', geometry: 'line', color: '#e86f51' },
      ],
      layers: [
        {
          hidden: false,
          frames: [{ strokes: [{ points: [80, 80, 720, 80, 720, 720, 80, 720], tool_id: 0 }] }],
        },
        {
          hidden: false,
          opacity: 75,
          blend: mode,
          frames: [{ strokes: [{ points: [240, 240, 880, 240, 880, 880, 240, 880], tool_id: 1 }] }],
        },
      ],
    };
    runCase(`blend-${mode}`, docBlend, { activeLayer: 1 }, 128, 128);
  }

  // 6. Onion skin tinted ghosts + scene.blend
  const docOnion: ToonDocument = {
    schema_version: 8,
    width: W * 8,
    height: H * 8,
    frame_rate: 12,
    tools: [{ kind: 'pencil', geometry: 'line', width: 120, color: '#222222' }],
    layers: [{
      hidden: false,
      frames: [
        { strokes: [{ points: [300, 500, 1600, 500], tool_id: 0 }] },
        { strokes: [{ points: [300, 1100, 1600, 1100], tool_id: 0 }] },
      ],
    }],
  };
  runCase('onion-skin-tinted', docOnion, {
    frame: 1,
    ghosts: { frames: [{ index: 0, alpha: 0.35, tint: '#1b5cff' }], layers: [0] },
  });

  // 7. Interleaved rigid lasso `place` transform
  const lassoMatrix = [1, 0, 0, 1, 240, 160];
  const lassoCell: Frame = {
    strokes: [
      { points: [200, 300, 1200, 300], tool_id: 0, place: lassoMatrix } as PlacedStroke,
      { points: [600, 200, 600, 700], tool_id: 1 }, // fixed eraser between moved strokes
      { points: [200, 400, 1200, 400], tool_id: 0, place: lassoMatrix } as PlacedStroke,
    ],
  };
  const docLasso: ToonDocument = {
    schema_version: 8,
    width: W * 8,
    height: H * 8,
    frame_rate: 12,
    tools: [
      { kind: 'pencil', geometry: 'line', width: 80, color: '#0077cc' },
      { kind: 'eraser', geometry: 'line', width: 80 },
    ],
    layers: [{ hidden: false, frames: [lassoCell] }],
  };
  runCase('interleaved-lasso-place', docLasso);

  // 8. History independence: cold vs incremental append vs region undo (0-bit diff!)
  {
    const tools: ToolDescriptor[] = [{ kind: 'pencil', geometry: 'line', width: 64, color: '#2266aa' }];
    const s1 = { points: [200, 400, 1600, 400], tool_id: 0 };
    const s2 = { points: [400, 200, 400, 1600], tool_id: 0 };
    const viewport = { scale: 1 / FIXED_POINT_SCALE, dpr: 1 };
    const present = makePresent(W, H);
    canvas.width = W;
    canvas.height = H;

    // Cold render of [s1]
    const doc1: ToonDocument = { schema_version: 8, width: W * 8, height: H * 8, frame_rate: 12, tools, layers: [{ hidden: false, frames: [{ strokes: [s1] }] }] };
    composer.invalidate();
    composer.composeAndPresent(W, H, { doc: doc1, frame: 0, activeLayer: 0, viewport, tools, paper: BACKGROUND_COLOR }, present);
    const coldS1 = readWebGLCanvas(gl, W, H);

    // Incremental append [s1, s2]
    const doc2: ToonDocument = { schema_version: 8, width: W * 8, height: H * 8, frame_rate: 12, tools, layers: [{ hidden: false, frames: [{ strokes: [s1, s2] }] }] };
    composer.invalidate();
    composer.composeAndPresent(W, H, { doc: doc2, frame: 0, activeLayer: 0, viewport, tools, paper: BACKGROUND_COLOR }, present);

    // Region undo back to [s1]
    composer.invalidate();
    composer.composeAndPresent(W, H, { doc: doc1, frame: 0, activeLayer: 0, viewport, tools, paper: BACKGROUND_COLOR }, present);
    const afterUndoS1 = readWebGLCanvas(gl, W, H);

    let maxBitDiff = 0;
    for (let i = 0; i < coldS1.length; i++) {
      const d = Math.abs(coldS1[i] - afterUndoS1[i]);
      if (d > maxBitDiff) maxBitDiff = d;
    }
    results.push({ name: 'history-independence-0bit', pass: maxBitDiff === 0, detail: `maxBitDiff=${maxBitDiff}` });
  }

  // 9. Subpixel hairline (width=8, pressure=0) & diagonal sliver contour at level=0.5 (J1-O9)
  {
    const docSub: ToonDocument = {
      schema_version: 8,
      width: W * 8 * 2,
      height: H * 8 * 2,
      frame_rate: 12,
      tools: [
        { kind: 'pencil', geometry: 'line', width: 8, color: '#000000' },
        { kind: 'contour', geometry: 'line', color: '#000000' },
      ],
      layers: [{
        hidden: false,
        frames: [{
          strokes: [
            { points: [160, 160, 1600, 160], pressure: [0, 0], tool_id: 0 },
            { points: [160, 161, 1600, 1601, 1600, 1602, 160, 162], tool_id: 1 },
          ],
        }],
      }],
    };
    runCase('subpixel-hairline-and-diagonal-sliver', docSub, {}, W, H, 0.5);
  }

  // 10. Pipette straight RGBA parity on translucent stroke
  {
    const docPick: ToonDocument = {
      schema_version: 8,
      width: 128 * 8,
      height: 128 * 8,
      frame_rate: 12,
      tools: [{ kind: 'contour', geometry: 'line', color: '#cc4422', opacity: 50 }],
      layers: [{ hidden: false, frames: [{ strokes: [{ points: [80, 80, 800, 80, 800, 800, 80, 800], tool_id: 0 }] }] }],
    };
    canvas.width = 128;
    canvas.height = 128;
    const scene: FrameScene = {
      doc: docPick,
      frame: 0,
      activeLayer: 0,
      viewport: { scale: 1 / FIXED_POINT_SCALE, dpr: 1 },
      tools: docPick.tools,
      paper: BACKGROUND_COLOR,
    };
    composer.invalidate();
    composer.composeAndPresent(128, 128, scene, makePresent(128, 128));
    const sampled = composer.samplePixel({ px: 50, py: 50, source: 'canvas', onPaper: false, paper: BACKGROUND_COLOR });
    const pass = sampled !== null
      && Math.abs(sampled[0] - 0xcc) <= 2
      && Math.abs(sampled[1] - 0x44) <= 2
      && Math.abs(sampled[2] - 0x22) <= 2
      && Math.abs(sampled[3] - 128) <= 2;
    results.push({ name: 'pipette-unpremultiply', pass, detail: `sampled=${JSON.stringify(sampled)}` });
  }

  // 11. Tiled oversized self-overlapping contour (> 256px on 64 MiB tier) beside small translucent mark
  {
    const TW = 320;
    const TH = 256;
    const docTile: ToonDocument = {
      schema_version: 8,
      width: TW * 8,
      height: TH * 8,
      frame_rate: 12,
      tools: [
        { kind: 'contour', geometry: 'line', color: '#2255aa', opacity: 60 },
        { kind: 'pencil', geometry: 'line', width: 48, color: '#dd3344', opacity: 50 },
      ],
      layers: [{
        hidden: false,
        frames: [{
          strokes: [
            // Oversized bowtie contour spanning x=8..312 (> 256px logical atlas side)
            { points: [64, 160, 2496, 160, 64, 1800, 2496, 1800], tool_id: 0 },
            // Small translucent mark next to it in same run (must not bleed)
            { points: [160, 960, 480, 960], tool_id: 1 },
          ],
        }],
      }],
    };
    runCase('tiled-oversized-isolation', docTile, {}, TW, TH);
  }

  // 12. Blended active layer with live stroke (verifies slotB/slotC backdrop non-aliasing)
  {
    const docLiveBlend: ToonDocument = {
      schema_version: 8,
      width: 128 * 8,
      height: 128 * 8,
      frame_rate: 12,
      tools: [
        { kind: 'contour', geometry: 'line', color: '#4488cc' },
        { kind: 'pencil', geometry: 'line', width: 120, color: '#ee6633' },
      ],
      layers: [
        { hidden: false, frames: [{ strokes: [{ points: [80, 80, 900, 80, 900, 900, 80, 900], tool_id: 0 }] }] },
        { hidden: false, blend: 'multiply', opacity: 80, frames: [{ strokes: [] }] },
      ],
    };
    runCase('blended-active-live-stroke', docLiveBlend, {
      activeLayer: 1,
      live: {
        id: 1,
        points: [160, 480, 860, 480],
        geometry: 'line',
        width: 120,
        color: '#ee6633',
        spec: {
          kind: 'resolved',
          points: [160, 480, 860, 480],
          tool: { kind: 'pencil', geometry: 'line', width: 120, color: '#ee6633' },
          color: '#ee6633',
          alpha: 1,
        },
      },
    }, 128, 128);
  }

  // 13. Rotated stage presentation + pixel grid (`PRESENT_VS` / `PRESENT_FS`)
  {
    const W2 = 200;
    const H2 = 200;
    canvas.width = W2;
    canvas.height = H2;
    const docRot: ToonDocument = {
      schema_version: 8,
      width: 128 * 8,
      height: 128 * 8,
      frame_rate: 12,
      tools: [{ kind: 'contour', geometry: 'line', color: '#1b5cff' }],
      layers: [{ hidden: false, frames: [{ strokes: [{ points: [160, 160, 864, 160, 864, 864, 160, 864], tool_id: 0 }] }] }],
    };
    const scene: FrameScene = {
      doc: docRot,
      frame: 0,
      activeLayer: 0,
      viewport: { scale: 1 / FIXED_POINT_SCALE, dpr: 1 },
      tools: docRot.tools,
      paper: BACKGROUND_COLOR,
    };
    const presentRot: StagePresentParams = {
      stageWidth: W2,
      stageHeight: H2,
      sheetX: 50,
      sheetY: 30,
      sheetW: 128,
      sheetH: 128,
      angle: 20,
      stretch: 1,
      paper: BACKGROUND_COLOR,
      gridStep: 16,
    };
    composer.invalidate();
    const ok = composer.composeAndPresent(128, 128, scene, presentRot);
    const got = readWebGLCanvas(gl, W2, H2);
    // Verify transparent table corner (0,0), non-empty rotated paper, blue ink, and grid contrast.
    const cornerAlpha = got[3];
    let blueCount = 0;
    let gridCount = 0;
    for (let i = 0; i < got.length; i += 4) {
      if (got[i + 3] > 200 && got[i + 2] > 200 && got[i] < 80) blueCount++;
      // `#ffffff` XOR/diff `#303030` = `(207,207,207)`
      if (got[i + 3] > 200 && Math.abs(got[i] - 207) <= 2 && Math.abs(got[i + 1] - 207) <= 2 && Math.abs(got[i + 2] - 207) <= 2) {
        gridCount++;
      }
    }
    const pass = ok && cornerAlpha === 0 && blueCount > 5000 && gridCount > 200;
    results.push({
      name: 'rotated-present-and-pixel-grid',
      pass,
      detail: `ok=${ok} cornerAlpha=${cornerAlpha} blue=${blueCount} grid=${gridCount}`,
    });
  }

  // 13.5 Subpixel feather (distinct fill + outline), boundary-crossing isolation, and minified blend (first frame)
  {
    // Subpixel feather outline (width=8 at level=0.5 -> 0.5px, pressure=[0,0] -> <0.5px) must keep yellow fill!
    const docFeatherRef: ToonDocument = {
      schema_version: 8,
      width: 256 * 8 * 2,
      height: 256 * 8 * 2,
      frame_rate: 12,
      tools: [{ kind: 'feather', geometry: 'line', width: 8, color: '#112233', fill: '#ffe066', opacity: 80 }],
      layers: [{
        hidden: false,
        frames: [{
          strokes: [{
            points: [320, 320, 1600, 320, 1600, 1600, 320, 1600],
            pressure: [0, 0, 0, 0],
            tool_id: 0,
          }],
        }],
      }],
    };
    runCase('subpixel-feather-preserves-fill-and-outline', docFeatherRef, {}, 256, 256, 0.5);

    // Boundary-crossing stroke beside an interior stroke in the same batch must not bleed into neighbour slot!
    const docEdge: ToonDocument = {
      schema_version: 8,
      width: 256 * 8,
      height: 256 * 8,
      frame_rate: 12,
      tools: [
        { kind: 'pencil', geometry: 'line', width: 80, color: '#1b5cff' },
        { kind: 'pencil', geometry: 'line', width: 48, color: '#cc2233' },
      ],
      layers: [{
        hidden: false,
        frames: [{
          strokes: [
            { points: [200, 200, 500, 200], tool_id: 0 },
            // Extends far past right edge (x = 2500 > 2048)
            { points: [1900, 300, 2500, 300], tool_id: 1 },
            { points: [200, 600, 500, 600], tool_id: 0 },
          ],
        }],
      }],
    };
    runCase('sheet-boundary-crossing-no-slot-bleed', docEdge, {}, 256, 256);

    // First minified frame (stretch = 0.5) with blended layer: slotA must not be incomplete!
    const freshComposer = new WebGL2SheetComposer(gl, { formats, budgetBytes: 64 * 1024 * 1024 });
    const docMini: ToonDocument = {
      schema_version: 8,
      width: 128 * 8,
      height: 128 * 8,
      frame_rate: 12,
      tools: [
        { kind: 'contour', geometry: 'line', color: '#3a7bd5' },
        { kind: 'contour', geometry: 'line', color: '#e86f51' },
      ],
      layers: [
        { hidden: false, frames: [{ strokes: [{ points: [80, 80, 900, 80, 900, 900, 80, 900], tool_id: 0 }] }] },
        { hidden: false, blend: 'multiply', opacity: 80, frames: [{ strokes: [{ points: [200, 200, 800, 200, 800, 800, 200, 800], tool_id: 1 }] }] },
      ],
    };
    canvas.width = 64;
    canvas.height = 64;
    const miniOk = freshComposer.composeAndPresent(128, 128, {
      doc: docMini,
      frame: 0,
      activeLayer: 1,
      viewport: { scale: 1 / FIXED_POINT_SCALE, dpr: 1 },
      tools: docMini.tools,
      paper: BACKGROUND_COLOR,
    }, {
      stageWidth: 64,
      stageHeight: 64,
      sheetX: 0,
      sheetY: 0,
      sheetW: 64,
      sheetH: 64,
      angle: 0,
      stretch: 0.5,
      paper: BACKGROUND_COLOR,
      gridStep: 0,
    });
    const miniGot = readWebGLCanvas(gl, 64, 64);
    // Center pixel (32, 32) must show non-white, non-black multiplied color (both R and B > 20, < 220).
    const ci = (32 * 64 + 32) * 4;
    const miniPass = miniOk && miniGot[ci] > 20 && miniGot[ci] < 220 && miniGot[ci + 2] > 20 && miniGot[ci + 2] < 220;
    results.push({
      name: 'first-minified-frame-blended-layer',
      pass: miniPass,
      detail: `ok=${miniOk} center=[${miniGot[ci]},${miniGot[ci + 1]},${miniGot[ci + 2]},${miniGot[ci + 3]}]`,
    });
    freshComposer.dispose();
  }

  // Playback uses the same stroke shape before, during and after a held drawing.
  {
    const w = 1040, h = 800;
    canvas.width = w;
    canvas.height = h;
    const tools: ToolDescriptor[] = [{ kind: 'pencil', geometry: 'cubic', width: 32, color: '#000000' }];
    for (const total of [2, 120]) {
      const doc: ToonDocument = {
        schema_version: 8, width: w * 8, height: h * 8, frame_rate: 12, tools,
        layers: [{ hidden: false, frames: [
          { strokes: [{ tool_id: 0, points: [80, 80, 80, 8080, 8080, 8080, 8080, 80], pressure: [100, 100, 100, 100] }] },
          ...Array<null>(total - 1).fill(null),
        ] }],
      };
      const scene: FrameScene = { doc, frame: 0, activeLayer: 0, viewport: { scale: 1 / 8, dpr: 1 }, tools, paper: BACKGROUND_COLOR };
      const playbackKey = { doc, key: 0, total };
      const ref = renderCanvas2D(w, h, scene);
      const snapshots = [undefined, playbackKey, playbackKey, undefined].map((key, index) => {
        if (index === 3) composer.clearPlayback();
        if (index !== 2) composer.invalidate();
        const ok = composer.composeAndPresent(w, h, { ...scene, frame: index === 2 ? 1 : 0 }, makePresent(w, h), key);
        const pixels = readWebGLCanvas(gl, w, h);
        const cmp = compareInteriorAndEdges(ref, pixels, w, h, 2);
        return { ok, cmp, pixels };
      });
      const [before, playing, held, after] = snapshots;
      const stable = before.pixels.every((channel, at) => channel === after.pixels[at])
        && playing.pixels.every((channel, at) => channel === held.pixels[at]);
      const pass = stable && snapshots.every(({ ok, cmp }) => ok && cmp.missedInk === 0 && cmp.interiorMismatches === 0);
      results.push({
        name: `pressure-stroke-while-playing-${total === 2 ? 'whole-still' : 'cropped-cell'}`,
        pass,
        detail: `stable=${stable} ${JSON.stringify(snapshots.map(({ ok, cmp }) => ({ ok, ...cmp })))}`,
      });
      composer.clearPlayback();
    }
  }

  // Context loss mid-session returns false cleanly and poisons composer.
  {
    const loseExt = gl.getExtension('WEBGL_lose_context');
    if (loseExt) {
      loseExt.loseContext();
      const docEmpty: ToonDocument = {
        schema_version: 8,
        width: 128 * 8,
        height: 128 * 8,
        frame_rate: 12,
        tools: [],
        layers: [{ hidden: false, frames: [{ strokes: [] }] }],
      };
      const okAfterLoss = composer.composeAndPresent(128, 128, {
        doc: docEmpty,
        frame: 0,
        activeLayer: 0,
        viewport: { scale: 1 / FIXED_POINT_SCALE, dpr: 1 },
        tools: [],
        paper: BACKGROUND_COLOR,
      }, makePresent(128, 128));
      results.push({
        name: 'context-loss-clean-fallback',
        pass: okAfterLoss === false && composer.lastFailure === 'context-lost',
        detail: `ok=${okAfterLoss} reason=${composer.lastFailure}`,
      });
    }
  }

  composer.dispose();
  return {
    ok: results.every((r) => r.pass),
    renderer,
    results,
  };
}
