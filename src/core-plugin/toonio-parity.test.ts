/**
 * Runs the reference toonio.ru drawing code (tools.js `Tool`, the bundle's
 * `CreatePointData` / `MousePos`) against our Tonio pipeline on random
 * strokes. Skips when the reference checkout is not on this machine
 * (`TOONIO_REF` overrides the default path).
 */
import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXED_POINT_SCALE } from '../lib/format/constants';
import { emitGeometry } from '../lib/render/smoothing';
import {
  layToonioPoints,
  toonioPrepare,
  toonioRules,
  toonioSmooth,
} from './toonio';
import { toDocument } from '../lib/ui/viewport';
import {
  beginStrokeSession,
  appendStrokeEvent,
  finishStrokeEvent,
  commitStrokeSession,
  previewStrokeSession,
} from '../lib/tools/profiles';

const REF = process.env.TOONIO_REF ?? '/home/sergey/Documents/toonio_editor';
const available = existsSync(join(REF, 'js/app/src/tools.js'));

interface RefLine { d: { t: number; w: number; c: string }; p: number[]; s: number; m: number }
interface Ref {
  toonio: { drawWindow: { scale: number } };
  tool: { Smooth(l: RefLine): RefLine; Prepare(l: RefLine): RefLine; Curve(ctx: unknown, l: RefLine, s?: number): void };
  createPointData(e: FakeEvent, canvas: FakeCanvas, scale: number, tx: number, ty: number, oldPen: boolean): number[];
}
interface FakeEvent { pointerId: number; clientX: number; clientY: number; getCoalescedEvents?: () => FakeEvent[] }
interface FakeCanvas { width: number; height: number; getBoundingClientRect(): { left: number; top: number; right: number; bottom: number } }

function loadReference(): Ref {
  const tools = readFileSync(join(REF, 'js/app/src/tools.js'), 'utf8');
  const toolClass = tools.slice(tools.indexOf('class Tool'), tools.indexOf('class Pencil'));
  const bundle = readFileSync(join(REF, 'js/app/toonio.bundle.js'), 'utf8');
  const cut = (start: string, end: string) => bundle.slice(bundle.indexOf(start), bundle.indexOf(end, bundle.indexOf(start)));
  const mousePos = cut('MousePos(a,b,c=1,d=0,e=0){', 'HEX(a){');
  const createPointData = cut('CreatePointData(a){', 'MouseDown(a){');
  const src = `
    const ERASER = 0, PENCIL = 1, FEATHER = 2, MEGAERASER = 3, PIXEL = 4;
    const toonio = { drawWindow: { scale: 1 } };
    const utils = { ${mousePos} };
    ${toolClass}
    const win = {
      ${createPointData}
    };
    return {
      toonio,
      tool: new Tool(PENCIL),
      createPointData: (e, canvas, scale, tx, ty, oldPen) => {
        const self = Object.assign(Object.create(win), { canvas, scale, translate: { x: tx, y: ty }, oldPen });
        return self.CreatePointData(e);
      },
    };`;
  return new Function(src)() as Ref;
}

/** Deterministic LCG so a failure reproduces. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomLine(rand: () => number): number[] {
  const n = 1 + Math.floor(rand() * 60);
  const p: number[] = [];
  let x = Math.floor(rand() * 1280);
  let y = Math.floor(rand() * 720);
  for (let i = 0; i < n; i++) {
    p.push(x, y);
    // Small steps, so the min-distance threshold actually bites, plus the
    // odd repeat the capture dedup lets through across batches.
    if (rand() > 0.15) {
      x += Math.floor(rand() * 9) - 4;
      y += Math.floor(rand() * 9) - 4;
    }
  }
  return p;
}

class PathRecorder {
  ops: (string | number)[][] = [];
  moveTo(x: number, y: number) { this.ops.push(['M', x, y]); }
  lineTo(x: number, y: number) { this.ops.push(['L', x, y]); }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) { this.ops.push(['Q', cx, cy, x, y]); }
  bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) {
    this.ops.push(['C', a, b, c, d, x, y]);
  }
}

/**
 * The reference nudged a curve by this much where two points coincided, so its
 * own emitter would not divide by zero; the shared reader has no such need and
 * lands on the point itself. 0.01 reference px is 1/800 of a logical pixel, and
 * it is the only place our line may differ from tools.js.
 */
const REFERENCE_NUDGE = 0.01 + 1e-9;

/** Asserts two command streams have the same shape and differ by at most `tol`. */
function expectSameCurve(ours: (string | number)[][], theirs: (string | number)[][], tol: number) {
  expect(ours.map((op) => op[0])).toEqual(theirs.map((op) => op[0]));
  for (let i = 0; i < theirs.length; i++) {
    expect(ours[i].length).toBe(theirs[i].length);
    for (let j = 1; j < theirs[i].length; j++) {
      expect(Math.abs((ours[i][j] as number) - (theirs[i][j] as number))).toBeLessThanOrEqual(tol);
    }
  }
}

const toDoc = (p: readonly number[]) => p.map((v) => v * FIXED_POINT_SCALE);
const fromDoc = (p: readonly number[]) => p.map((v) => v / FIXED_POINT_SCALE);

describe.skipIf(!available)('Tonio drawing parity with the reference checkout', () => {
  const ref = loadReference();
  const rand = rng(20260920);

  it('Smooth, Prepare and Curve match tools.js on random strokes, any s / m / zoom', () => {
    for (let run = 0; run < 400; run++) {
      const p = randomLine(rand);
      const s = 1 + Math.floor(rand() * 8);
      const m = Math.floor(rand() * 8);
      const zoom = [1, 1.5, 2, 4, 10][Math.floor(rand() * 5)];
      ref.toonio.drawWindow.scale = zoom;
      const line: RefLine = { d: { t: 1, w: 5, c: '#000000' }, p: p.slice(), s, m };

      const refSmooth = ref.tool.Smooth(line);
      expect(fromDoc(toonioSmooth(toDoc(p), s))).toEqual(refSmooth.p);

      const refPrepared = ref.tool.Prepare(refSmooth);
      expect(fromDoc(toonioPrepare(toonioSmooth(toDoc(p), s), m, zoom))).toEqual(refPrepared.p);

      // Live path (Smooth) and committed path (Prepare) rasterize through the
      // same Curve. Our path runs in document units, so compare after /8.
      for (const points of [refSmooth.p, refPrepared.p] as const) {
        const a = new PathRecorder();
        ref.tool.Curve(a, { ...line, p: points });
        const b = new PathRecorder();
        emitGeometry(layToonioPoints(points), 'smooth', false, b);
        // The shared reader opens with a moveTo the reference leaned on the
        // canvas to do for it; from there the curves are the same line.
        expect(b.ops[0]).toEqual(['M', points[0], points[1]]);
        expectSameCurve(b.ops.slice(1), a.ops, REFERENCE_NUDGE);
      }
    }
  });

  it('collects the same points as CreatePointData from coalesced pointer batches', () => {
    for (let run = 0; run < 200; run++) {
      const zoom = [1, 2, 4][Math.floor(rand() * 3)];
      const cssW = 600 + Math.floor(rand() * 900);
      const cssH = cssW * 720 / 1280;
      const panX = -Math.floor(rand() * cssW * (zoom - 1));
      const panY = -Math.floor(rand() * cssH * (zoom - 1));
      const oldPen = rand() < 0.2;
      // Reference: translate is in bitmap px, pan in CSS px.
      const tx = panX * 1280 / cssW;
      const ty = panY * 720 / cssH;
      const canvas: FakeCanvas = {
        width: 1280, height: 720,
        getBoundingClientRect: () => ({ left: 0, top: 0, right: cssW, bottom: cssH }),
      };
      const rect = { width: cssW, height: cssH };
      const doc = { width: 1280 * FIXED_POINT_SCALE, height: 720 * FIXED_POINT_SCALE };
      const view = { zoom, panX, panY };

      const events: FakeEvent[] = [];
      let x = rand() * cssW;
      let y = rand() * cssH;
      const batches = 1 + Math.floor(rand() * 12);
      for (let b = 0; b < batches; b++) {
        const coalesced: FakeEvent[] = [];
        const n = Math.floor(rand() * 5);
        for (let i = 0; i < n; i++) {
          if (rand() > 0.2) { x += rand() * 6 - 3; y += rand() * 6 - 3; }
          coalesced.push({ pointerId: 1, clientX: x, clientY: y });
        }
        // The main event is the last coalesced sample, as browsers do it.
        const main = coalesced.length ? coalesced[coalesced.length - 1] : { pointerId: 1, clientX: x, clientY: y };
        events.push({ ...main, getCoalescedEvents: () => coalesced });
      }

      let expected: number[] = [];
      for (const e of events) expected = expected.concat(ref.createPointData(e, canvas, zoom, tx, ty, oldPen));

      const sample = (e: FakeEvent) => {
        const [sx, sy] = toDocument(e.clientX, e.clientY, rect, doc, view);
        const coalesced = oldPen ? undefined : e.getCoalescedEvents!().map((c) => {
          const [cx, cy] = toDocument(c.clientX, c.clientY, rect, doc, view);
          return { pointerId: c.pointerId, isPrimary: true, x: cx, y: cy };
        });
        return { pointerId: e.pointerId, isPrimary: true, x: sx, y: sy, coalesced };
      };
      const session = beginStrokeSession(sample(events[0]), { kind: 'pencil', geometry: 'smooth', width: 40, color: '#000000' }, toonioRules({ smooth: 3, minDistance: 3 }), zoom);
      for (const e of events.slice(1, -1)) appendStrokeEvent(session, sample(e));
      if (events.length > 1) finishStrokeEvent(session, sample(events[events.length - 1]));

      expect(fromDoc(session.rawPoints)).toEqual(expected);
      // And the whole gesture, preview and commit, lands where the reference
      // lands — laid down for the shared reader, which is the repeated first
      // point and nothing else.
      ref.toonio.drawWindow.scale = zoom;
      const line: RefLine = { d: { t: 1, w: 5, c: '#000000' }, p: expected, s: 3, m: 3 };
      expect(fromDoc(previewStrokeSession(session)))
        .toEqual(layToonioPoints(ref.tool.Smooth(line).p));
      expect(fromDoc(commitStrokeSession(session).points))
        .toEqual(layToonioPoints(ref.tool.Prepare(ref.tool.Smooth(line)).p));
    }
  });
});
