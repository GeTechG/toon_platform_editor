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
  zoomNotch,
  type Stage,
  renderDensity,
  reprojection,
  shotCovers,
  snapAngle,
  turnStep,
  rotateAt,
  toWorkspace,
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
    expect(clampPan({ zoom: 1, panX: 90, panY: -20, angle: 0 }, STAGE)).toEqual({
      zoom: 1,
      panX: 90,
      panY: -20,
      angle: 0,
    });
  });

  it('keeps an edge of a small sheet in reach, wherever it is pushed', () => {
    expect(clampPan({ zoom: 1, panX: 999, panY: -999, angle: 0 }, STAGE)).toEqual({
      zoom: 1,
      panX: STAGE.width - EDGE_KEEP,
      panY: EDGE_KEEP - 100,
      angle: 0,
    });
  });

  it('lets a zoomed sheet be pushed off the workspace, keeping an edge in reach', () => {
    // zoom 3: a 600×300 sheet on a 400px-wide workspace.
    const view = { zoom: 3, panX: 999, panY: 0, angle: 0 };
    expect(clampPan(view, STAGE).panX).toBe(STAGE.width - EDGE_KEEP);
    expect(clampPan({ ...view, panX: -999 }, STAGE).panX).toBe(EDGE_KEEP - 600);
  });

  it('leaves a pan inside those bounds alone', () => {
    expect(clampPan({ zoom: 4, panX: -120, panY: -30, angle: 0 }, STAGE)).toEqual({
      zoom: 4,
      panX: -120,
      panY: -30,
      angle: 0,
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
    expect(fitView(STAGE)).toEqual({ zoom: 1, panX: 100, panY: 100, angle: 0 });
  });
});

describe('zoomAt', () => {
  it('keeps the document point under the pointer in place', () => {
    const from = clampPan({ zoom: 2, panX: -100, panY: -50, angle: 0 }, STAGE);
    const view = zoomAt(from, 4, 180, 120, STAGE);
    expect(view.zoom).toBe(4);
    expect(toDocument(180, 120, SHEET, DOC, view)).toEqual(toDocument(180, 120, SHEET, DOC, from));
  });
});

describe('toDocument', () => {
  it('maps canvas pixels to document units against the sheet, not the workspace', () => {
    expect(toDocument(0, 0, SHEET, DOC, { zoom: 1, panX: 0, panY: 0, angle: 0 })).toEqual([0, 0]);
    expect(toDocument(200, 100, SHEET, DOC, { zoom: 1, panX: 0, panY: 0, angle: 0 })).toEqual([4800, 2400]);
  });

  it('accounts for zoom and pan', () => {
    expect(toDocument(0, 0, SHEET, DOC, { zoom: 2, panX: -200, panY: -100, angle: 0 })).toEqual([2400, 1200]);
  });

  it('reads negative units off the workspace beside the sheet', () => {
    const [x] = toDocument(-100, 0, SHEET, DOC, { zoom: 1, panX: 0, panY: 0, angle: 0 });
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
  const at = (zoom: number, panX: number, panY: number, dpr = 1) => ({ zoom, panX, panY, angle: 0, dpr });

  it('a still view maps the picture onto itself', () => {
    expect(reprojection(at(1.5, 40, 20, 2), at(1.5, 40, 20, 2))).toEqual({ scale: 1, x: 0, y: 0, turn: 0 });
  });

  it('a pan moves the picture by the pan, in device pixels', () => {
    expect(reprojection(at(1, 10, 10, 2), at(1, 25, 5, 2))).toEqual({ scale: 1, x: 30, y: -10, turn: 0 });
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
    expect(zoomAt({ zoom: 1, panX: 100, panY: 100, angle: 0 }, 1.37, 200, 150, STAGE, false).zoom).toBe(1.37);
    expect(zoomAt({ zoom: 1, panX: 100, panY: 100, angle: 0 }, 42, 200, 150, STAGE, false).zoom).toBe(10);
    expect(zoomAt({ zoom: 1, panX: 100, panY: 100, angle: 0 }, 0.01, 200, 150, STAGE, false).zoom).toBe(0.1);
    // The keys and the wheel still land on the notches.
    expect(zoomAt({ zoom: 1, panX: 100, panY: 100, angle: 0 }, 1.37, 200, 150, STAGE).zoom).toBe(1.5);
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

// The sheet turns on the table as paper does under the hand (owner,
// 2026-10-13). The angle is in degrees, clockwise on the screen; the pan is
// still where the sheet's own top-left corner lies.
describe('a turned sheet', () => {
  const view = (zoom: number, panX: number, panY: number, angle: number) => ({ zoom, panX, panY, angle });

  it('reads the pointer in the sheet\'s own axes', () => {
    // A quarter turn about the corner at (200, 100): the top edge runs down.
    const turned = view(1, 200, 100, 90);
    expect(toDocument(200, 300, SHEET, DOC, turned)[0]).toBeCloseTo(4800);
    expect(toDocument(200, 300, SHEET, DOC, turned)[1]).toBeCloseTo(0);
    expect(toDocument(100, 100, SHEET, DOC, turned)[0]).toBeCloseTo(0);
    expect(toDocument(100, 100, SHEET, DOC, turned)[1]).toBeCloseTo(2400);
  });

  it('puts a point of the document back where the pointer read it', () => {
    const turned = view(1.5, 120, 40, 30);
    const [x, y] = toWorkspace(1200, 1800, SHEET, DOC, turned);
    const [u, v] = toDocument(x, y, SHEET, DOC, turned);
    expect(u).toBeCloseTo(1200);
    expect(v).toBeCloseTo(1800);
    expect(toWorkspace(4800, 0, SHEET, DOC, view(1, 200, 100, 90))[1]).toBeCloseTo(300);
  });

  it('turns about the point it is asked to, which stays where it was', () => {
    // The sheet in the middle of the table, turned about its own middle.
    const next = rotateAt(view(1, 100, 100, 0), 90, 200, 150, STAGE);
    expect(next.angle).toBe(90);
    expect(next.panX).toBeCloseTo(250);
    expect(next.panY).toBeCloseTo(50);
    const [u, v] = toDocument(200, 150, SHEET, DOC, next);
    expect(u).toBeCloseTo(2400);
    expect(v).toBeCloseTo(1200);
  });

  it('keeps the angle within half a turn either way', () => {
    expect(rotateAt(view(1, 100, 100, 170), 190, 200, 150, STAGE).angle).toBe(-170);
    expect(rotateAt(view(1, 100, 100, 0), 360, 200, 150, STAGE).angle).toBe(0);
  });

  it('zooms about the cursor as an upright one does', () => {
    const turned = view(1, 250, 50, 90);
    const before = toDocument(210, 120, SHEET, DOC, turned);
    const after = toDocument(210, 120, SHEET, DOC, zoomAt(turned, 2, 210, 120, STAGE));
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
  });

  it('is kept on the table by what it covers, not by what it covered upright', () => {
    // Turned a quarter, the 200×100 sheet stands 100 wide to the left of its corner.
    const kept = clampPan(view(1, 1000, 0, 90), STAGE);
    expect(kept.panX).toBeCloseTo(436);
    expect(kept.panY).toBeCloseTo(0);
    expect(kept.angle).toBe(90);
  });

  it('comes back upright with 100%', () => {
    expect(fitView(STAGE).angle).toBe(0);
  });
});

describe('turning by hand and by key', () => {
  it('a free turn sticks to every eighth of a turn it comes near, and to nothing else', () => {
    expect(snapAngle(3)).toBe(0);
    expect(snapAngle(-3.9)).toBe(0);
    expect(snapAngle(87)).toBe(90);
    expect(snapAngle(42)).toBe(45);
    expect(snapAngle(20)).toBe(20);
    expect(snapAngle(5)).toBe(5);
    // Past half a turn it is the same sheet from the other side.
    expect(snapAngle(183)).toBe(180);
    expect(snapAngle(200)).toBe(-160);
  });

  it('a key press leads to the next notch of fifteen degrees, from wherever the hand left the sheet', () => {
    expect(turnStep(0, 1)).toBe(15);
    expect(turnStep(0, -1)).toBe(-15);
    expect(turnStep(37, 1)).toBe(45);
    expect(turnStep(37, -1)).toBe(30);
    expect(turnStep(45, -1)).toBe(30);
    expect(turnStep(180, 1)).toBe(-165);
  });
});

describe('the grabbed picture under a turn', () => {
  const at = (zoom: number, panX: number, panY: number, angle: number, dpr = 1) => ({ zoom, panX, panY, angle, dpr });
  /** Where the canvas puts a pixel of the shot, as `setTransform` would. */
  const through = (r: { scale: number; x: number; y: number; turn: number }, x: number, y: number) => {
    const a = (r.turn * Math.PI) / 180;
    return [r.scale * (x * Math.cos(a) - y * Math.sin(a)) + r.x, r.scale * (x * Math.sin(a) + y * Math.cos(a)) + r.y];
  };

  it('turns about the sheet\'s corner with the view', () => {
    // The corner at (10, 20) stays; the point 100 px along the top edge goes down.
    const r = reprojection(at(1, 10, 20, 0, 2), at(1, 10, 20, 90, 2));
    expect(r.turn).toBe(90);
    expect(through(r, 20, 40)[0]).toBeCloseTo(20);
    expect(through(r, 20, 40)[1]).toBeCloseTo(40);
    expect(through(r, 220, 40)[0]).toBeCloseTo(20);
    expect(through(r, 220, 40)[1]).toBeCloseTo(240);
  });

  it('no longer holds the sheet once the view has turned: its corners came from off the table', () => {
    expect(shotCovers(at(1, 100, 100, 0), at(1, 100, 100, 0), STAGE)).toBe(true);
    expect(shotCovers(at(1, 100, 100, 0), at(1, 100, 100, 30), STAGE)).toBe(false);
  });

  it('holds a turned sheet that only slid, by the box it stands in', () => {
    // Stood on its side, the sheet reaches 200 px down from its corner.
    expect(shotCovers(at(1, 250, 50, 90), at(1, 260, 60, 90), STAGE)).toBe(true);
    expect(shotCovers(at(1, 250, 250, 90), at(1, 250, 150, 90), STAGE)).toBe(false);
  });
});

describe('zoomNotch: Ctrl and plus or minus go a finer ladder (owner, 2026-10-15)', () => {
  it('from 100% a tenth or so either way, not half', () => {
    expect(zoomNotch(1, 1)).toBe(1.1);
    expect(zoomNotch(1.1, 1)).toBe(1.25);
    expect(zoomNotch(1.5, 1)).toBe(1.75);
    expect(zoomNotch(1, -1)).toBe(0.9);
    expect(zoomNotch(2, -1)).toBe(1.75);
  });

  it('from between the notches it goes to the next one, not past it', () => {
    expect(zoomNotch(1.3, 1)).toBe(1.5);
    expect(zoomNotch(1.3, -1)).toBe(1.25);
  });

  it('stays inside the range', () => {
    expect(zoomNotch(10, 1)).toBe(10);
    expect(zoomNotch(0.1, -1)).toBe(0.1);
  });
});
