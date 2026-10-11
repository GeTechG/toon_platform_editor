import { describe, expect, it } from 'bun:test';
import {
  EDGE_KEEP,
  FIT_PADDING,
  fitSheet,
  clipCover,
  clampPan,
  clampZoom,
  fitView,
  toDocument,
  zoomAt,
  zoomDelta,
  type Stage,
  renderDensity,
  reprojection,
  ctrlWheelZoom,
  easeZoom,
  WHEEL_SOFT_RATE,
} from './viewport';

/** A 200×100 sheet lying on a 400×300 workspace. */
const STAGE: Stage = { width: 400, height: 300, sheetWidth: 200, sheetHeight: 100 };
const SHEET = { width: STAGE.sheetWidth, height: STAGE.sheetHeight };
const DOC = { width: 4800, height: 2400 };

describe('clampZoom', () => {
  it('snaps to the reference 0.5 step from 100% up', () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(1.7)).toBe(1.5);
    expect(clampZoom(42)).toBe(10);
  });

  it('steps by 0.1 below 100%, down to a tenth of the sheet', () => {
    expect(clampZoom(0.74)).toBe(0.7);
    expect(clampZoom(0.02)).toBe(0.1);
    expect(clampZoom(Number.NaN)).toBe(1);
  });
});

describe('zoomDelta', () => {
  it('takes the reference notch while zoomed in and a finer one below 100%', () => {
    expect(zoomDelta(1, 1)).toBe(0.5);
    expect(zoomDelta(1, -1)).toBe(-0.1);
    expect(zoomDelta(0.5, 1)).toBe(0.1);
    expect(zoomDelta(2, -1)).toBe(-0.5);
  });
});

describe('clampPan', () => {
  it('moves a sheet smaller than the workspace too — it lies loose on the table', () => {
    expect(clampPan({ zoom: 1, panX: 90, panY: -20 }, STAGE)).toEqual({
      zoom: 1,
      panX: 90,
      panY: -20,
    });
  });

  it('keeps an edge of a small sheet in reach, wherever it is pushed', () => {
    expect(clampPan({ zoom: 1, panX: 999, panY: -999 }, STAGE)).toEqual({
      zoom: 1,
      panX: STAGE.width - EDGE_KEEP,
      panY: EDGE_KEEP - 100,
    });
  });

  it('lets a zoomed sheet be pushed off the workspace, keeping an edge in reach', () => {
    // zoom 3: a 600×300 sheet on a 400px-wide workspace.
    const view = { zoom: 3, panX: 999, panY: 0 };
    expect(clampPan(view, STAGE).panX).toBe(STAGE.width - EDGE_KEEP);
    expect(clampPan({ ...view, panX: -999 }, STAGE).panX).toBe(EDGE_KEEP - 600);
  });

  it('leaves a pan inside those bounds alone', () => {
    expect(clampPan({ zoom: 4, panX: -120, panY: -30 }, STAGE)).toEqual({
      zoom: 4,
      panX: -120,
      panY: -30,
    });
  });
});

describe('fitSheet', () => {
  it('fits a wide document by width, with air left on both sides', () => {
    const sheet = fitSheet(400, 300, { width: 4800, height: 2400 });
    expect(sheet.width).toBe(400 - 2 * FIT_PADDING);
    expect(sheet.height).toBe((400 - 2 * FIT_PADDING) / 2);
  });

  it('fits a tall document by height instead', () => {
    const sheet = fitSheet(400, 300, { width: 1000, height: 2000 });
    expect(sheet.height).toBe(300 - 2 * FIT_PADDING);
    expect(sheet.width).toBe((300 - 2 * FIT_PADDING) / 2);
  });

  it('keeps a sheet even on a workspace too small for the margin', () => {
    const sheet = fitSheet(10, 10, { width: 1000, height: 1000 });
    expect(sheet.width).toBeGreaterThan(0);
    expect(sheet.height).toBeGreaterThan(0);
  });

  it('takes the width alone while the height is still unmeasured', () => {
    const sheet = fitSheet(400, Infinity, { width: 4800, height: 2400 });
    expect(sheet.width).toBe(400 - 2 * FIT_PADDING);
  });
});

describe('fitView', () => {
  it('is 100% with the sheet centred — what the reset button returns to', () => {
    expect(fitView(STAGE)).toEqual({ zoom: 1, panX: 100, panY: 100 });
  });
});

describe('zoomAt', () => {
  it('keeps the document point under the pointer in place', () => {
    const from = clampPan({ zoom: 2, panX: -100, panY: -50 }, STAGE);
    const view = zoomAt(from, 4, 180, 120, STAGE);
    expect(view.zoom).toBe(4);
    expect(toDocument(180, 120, SHEET, DOC, view)).toEqual(toDocument(180, 120, SHEET, DOC, from));
  });
});

describe('toDocument', () => {
  it('maps canvas pixels to document units against the sheet, not the workspace', () => {
    expect(toDocument(0, 0, SHEET, DOC, { zoom: 1, panX: 0, panY: 0 })).toEqual([0, 0]);
    expect(toDocument(200, 100, SHEET, DOC, { zoom: 1, panX: 0, panY: 0 })).toEqual([4800, 2400]);
  });

  it('accounts for zoom and pan', () => {
    expect(toDocument(0, 0, SHEET, DOC, { zoom: 2, panX: -200, panY: -100 })).toEqual([2400, 1200]);
  });

  it('reads negative units off the workspace beside the sheet', () => {
    const [x] = toDocument(-100, 0, SHEET, DOC, { zoom: 1, panX: 0, panY: 0 });
    expect(x).toBe(-2400);
  });
});

describe('renderDensity', () => {
  it('leaves an ordinary screen at its own density', () => {
    expect(renderDensity(1)).toBe(1);
    expect(renderDensity(1.5)).toBe(1.5);
    expect(renderDensity(2)).toBe(2);
  });

  it('caps a phone at two device pixels per CSS pixel', () => {
    // The editor holds about ten full-stage buffers; at density 3 their
    // backing store on a phone runs past a hundred megabytes, and on line art
    // 3× is not visible. 2.25× fewer pixels in every one of them.
    expect(renderDensity(3)).toBe(2);
    expect(renderDensity(4)).toBe(2);
  });

  it('falls back to one for a density the browser could not name', () => {
    expect(renderDensity(0)).toBe(1);
    expect(renderDensity(Number.NaN)).toBe(1);
  });
});

// Pan and pinch used to rebuild the whole frame — every layer from vectors,
// every ghost past its cache — on each animation frame of the gesture. While
// the hand moves the picture, the picture has not changed: the last composed
// frame is moved and scaled instead, and rebuilt once when the hand lets go.
describe('reprojection', () => {
  const at = (zoom: number, panX: number, panY: number, dpr = 1) => ({ zoom, panX, panY, dpr });

  it('a still view maps the picture onto itself', () => {
    expect(reprojection(at(1.5, 40, 20, 2), at(1.5, 40, 20, 2))).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it('a pan moves the picture by the pan, in device pixels', () => {
    expect(reprojection(at(1, 10, 10, 2), at(1, 25, 5, 2))).toEqual({ scale: 1, x: 30, y: -10 });
  });

  it('a zoom scales the picture about the new pan', () => {
    // A point at CSS x = 110 (pan 10 + 100 of sheet) at zoom 1 lies at
    // 20 + 200 = 220 at zoom 2 with pan 20.
    const r = reprojection(at(1, 10, 0), at(2, 20, 0));
    expect(r.scale * 110 + r.x).toBe(220);
  });

  it('carries a picture drawn at another density', () => {
    const r = reprojection(at(1, 0, 0, 2), at(1, 0, 0, 1));
    expect(r.scale).toBe(0.5);
  });
});

describe('the plain wheel', () => {
  it('a mouse notch is a tenth of the zoom, whichever unit the browser counts it in', () => {
    expect(ctrlWheelZoom(1, -100, 0, WHEEL_SOFT_RATE)).toBeCloseTo(1.105, 3);
    expect(ctrlWheelZoom(2, 100, 0, WHEEL_SOFT_RATE)).toBeCloseTo(1.81, 2);
    // Firefox counts lines (deltaMode 1): three of them are one notch.
    expect(ctrlWheelZoom(1, 3, 1, WHEEL_SOFT_RATE)).toBeCloseTo(0.905, 3);
  });

  it('seven notches double the sheet — the old first notch alone was 150%', () => {
    let zoom = 1;
    for (let i = 0; i < 7; i++) zoom = ctrlWheelZoom(zoom, -120, 0, WHEEL_SOFT_RATE);
    expect(zoom).toBeGreaterThan(1.9);
    expect(zoom).toBeLessThan(2.1);
  });

  it('a sideways swipe is not a zoom', () => {
    expect(ctrlWheelZoom(1.3, 0, 0, WHEEL_SOFT_RATE)).toBe(1.3);
  });
});

describe('the wheel zoom glides to its goal', () => {
  it('a frame covers part of the way, never past the goal', () => {
    const z = easeZoom(1, 1.105, 16);
    expect(z).toBeGreaterThan(1.01);
    expect(z).toBeLessThan(1.105);
    const out = easeZoom(1, 0.905, 16);
    expect(out).toBeLessThan(0.99);
    expect(out).toBeGreaterThan(0.905);
  });

  it('arrives within a fifth of a second and lands on the goal exactly', () => {
    let zoom = 1;
    let frames = 0;
    while (zoom !== 1.105 && frames < 100) {
      zoom = easeZoom(zoom, 1.105, 16);
      frames++;
    }
    expect(zoom).toBe(1.105);
    expect(frames * 16).toBeLessThanOrEqual(200);
  });

  it('goes the same way on a fast screen and a slow one', () => {
    const twoShort = easeZoom(easeZoom(1, 2, 8), 2, 8);
    expect(twoShort).toBeCloseTo(easeZoom(1, 2, 16), 6);
  });

  it('a stalled tab does not overshoot, and no time is no move', () => {
    expect(easeZoom(1, 2, 5000)).toBe(2);
    expect(easeZoom(1, 2, 0)).toBe(1);
  });
});

describe('zoomAt under two fingers', () => {
  it('follows the pinch smoothly instead of jumping between notches', () => {
    // Snapped, a pinch past 100% leapt 1 → 1.5 → 2 under the fingers.
    expect(zoomAt({ zoom: 1, panX: 100, panY: 100 }, 1.37, 200, 150, STAGE, false).zoom).toBe(1.37);
    expect(zoomAt({ zoom: 1, panX: 100, panY: 100 }, 42, 200, 150, STAGE, false).zoom).toBe(10);
    expect(zoomAt({ zoom: 1, panX: 100, panY: 100 }, 0.01, 200, 150, STAGE, false).zoom).toBe(0.1);
    // The keys and the wheel still land on the notches.
    expect(zoomAt({ zoom: 1, panX: 100, panY: 100 }, 1.37, 200, 150, STAGE).zoom).toBe(1.5);
  });
});

describe('a cover wider than the workspace', () => {
  it('counts only by what of it stands over the workspace', () => {
    // The bar floating under the canvas runs on under the tools column: its
    // left edge is 124 px before the workspace begins.
    expect(clipCover({ x: -124, y: 578, width: 1260, height: 151 }, 1146, 739))
      .toEqual({ x: 0, y: 578, width: 1136, height: 151 });
    expect(clipCover({ x: 20, y: 30, width: 40, height: 50 }, 1146, 739)).toEqual({ x: 20, y: 30, width: 40, height: 50 });
  });

  it('so the sheet is fitted over the bar, not under it', () => {
    const bar = clipCover({ x: -124, y: 578, width: 1260, height: 151 }, 1146, 739);
    const sheet = fitSheet(1146, 739, { width: 1280, height: 720 }, [bar]);
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(578 - FIT_PADDING + 1e-6);
  });
});
