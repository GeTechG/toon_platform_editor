/**
 * Runs the reference multator.ru drawing code — `LineGeneralization` and
 * `DrawField.multicurve` from the compiled OpenFL build — against our
 * Multator pipeline on random gestures. The gesture itself follows
 * DrawField.hx (onStartDraw / onDraw / onEndDraw) and the stroke shape rule
 * Frame.addSpline applies. Skips when the checkout is not on this machine
 * (`TOONATOR_REF` overrides the default path).
 */
import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CANVAS_LOGICAL_WIDTH, FIXED_POINT_SCALE } from '../lib/format/constants';
import type { Frame, ToolDescriptor } from '../lib/format/types';
import { renderStrokesLayer, type Canvas2DLike } from '../lib/render/canvas2d';
import { emitGeometry } from '../lib/render/smoothing';
import { MULTATOR_RULES } from './multator';
import { simplifyLang } from '../lib/tools/simplify';
import {
  appendStrokeEvent,
  beginStrokeSession,
  commitStrokeSession,
  finishStrokeEvent,
} from '../lib/tools/profiles';

const REF = process.env.TOONATOR_REF ?? '/home/sergey/Documents/toonator';
const BUILD = join(REF, 'Export/html5/bin/ToonatorEditor.js');
const available = existsSync(BUILD);

interface Pt { x: number; y: number }
interface Ref {
  simplifyLang(lookAhead: number, tolerance: number, points: Pt[]): Pt[];
  multicurve(points: Pt[], closed: boolean): string[];
}

function loadReference(): Ref {
  const js = readFileSync(BUILD, 'utf8');
  const cut = (start: string, end: string) => js.slice(js.indexOf(start), js.indexOf(end, js.indexOf(start)));
  const lang = cut('simplifyLang: function(param1,param2,param3) {', ',recursiveToleranceBar_old: function');
  const multicurve = cut('toonator_DrawField.multicurve = function', 'toonator_DrawField.multicurveX');
  const src = `
    const Reflect = { field: (o, k) => o[k] };
    const openfl_Vector = { toIntVector: () => [], toFloatVector: () => [] };
    const openfl_display_GraphicsPathWinding = { fromString: (s) => s };
    const lang = { ${lang} };
    const toonator_DrawField = {};
    ${multicurve}
    return {
      simplifyLang: (a, t, p) => lang.simplifyLang(a, t, p),
      multicurve: (points, closed) => {
        const ops = [];
        const g = { drawPath(cmds, data) {
          let i = 0;
          for (const c of cmds) {
            if (c === 1) ops.push('M' + data[i++] + ',' + data[i++]);
            else if (c === 2) ops.push('L' + data[i++] + ',' + data[i++]);
            else ops.push('Q' + data[i++] + ',' + data[i++] + ',' + data[i++] + ',' + data[i++]);
          }
        } };
        toonator_DrawField.multicurve(g, points, closed);
        return ops;
      },
    };`;
  return new Function(src)() as Ref;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

class PathRecorder {
  ops: string[] = [];
  moveTo(x: number, y: number) { this.ops.push(`M${x},${y}`); }
  lineTo(x: number, y: number) { this.ops.push(`L${x},${y}`); }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) { this.ops.push(`Q${cx},${cy},${x},${y}`); }
  bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) {
    this.ops.push(`C${a},${b},${c},${d},${x},${y}`);
  }
}

/** Just enough context to see whether a stroke lands as a circle or a path. */
class ShapeRecorder extends PathRecorder implements Canvas2DLike {
  canvas = { width: 600, height: 300 };
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  lineWidth = 0;
  strokeStyle = '';
  fillStyle = '';
  lineCap = '';
  lineJoin = '';
  setTransform() {}
  fillRect() {}
  clearRect() {}
  drawImage() {}
  beginPath() {}
  arc() { this.ops.push('circle'); }
  stroke() {}
  fill() {}
}

/**
 * One reference gesture: a press, some moves (a repeat now and then — the
 * reference never dedups) and a release that mostly lands where the last move
 * did, the way a real mouseup does.
 */
function gesture(rand: () => number): { down: Pt; moves: Pt[]; up: Pt } {
  const down = { x: rand() * 600, y: rand() * 300 };
  const moves: Pt[] = [];
  let x = down.x;
  let y = down.y;
  const n = rand() < 0.1 ? 0 : Math.floor(rand() * 40);
  for (let i = 0; i < n; i++) {
    if (rand() > 0.1) {
      x += rand() * 12 - 6;
      y += rand() * 12 - 6;
    }
    moves.push({ x, y });
  }
  const last = moves.length ? moves[moves.length - 1] : down;
  const up = rand() < 0.8 ? { ...last } : { x: last.x + rand() * 4 - 2, y: last.y + rand() * 4 - 2 };
  return { down, moves, up };
}

/** DrawField.onEndDraw: a click is a dot; anything else takes the mouseup point and is simplified. */
function referenceCommit(ref: Ref, g: ReturnType<typeof gesture>): Pt[] {
  const points = [g.down, ...g.moves];
  if (points.length === 1 && g.up.x === g.down.x && g.up.y === g.down.y) return points;
  return ref.simplifyLang(5, 10, [...points, g.up]);
}

const sample = (p: Pt, k: number) => ({ pointerId: 1, isPrimary: true, x: p.x * FIXED_POINT_SCALE * k, y: p.y * FIXED_POINT_SCALE * k });

/**
 * The gesture as the editor sees it on a document of `documentWidth` logical
 * px. The reference drew on 600, so its points are stretched to that document
 * and the engine is handed the document's own normalisation.
 */
function ourCommit(g: ReturnType<typeof gesture>, documentWidth = 600): number[] {
  const k = documentWidth / 600;
  const coordinateScale = CANVAS_LOGICAL_WIDTH / documentWidth;
  const descriptor: ToolDescriptor = { kind: 'pencil', geometry: 'smooth', width: 32, color: '#000000' };
  const session = beginStrokeSession(sample(g.down, k), descriptor, MULTATOR_RULES, coordinateScale);
  for (const m of g.moves) appendStrokeEvent(session, sample(m, k));
  finishStrokeEvent(session, sample(g.up, k));
  return commitStrokeSession(session).points;
}

describe.skipIf(!available)('Multator drawing parity with the reference build', () => {
  const ref = loadReference();
  const rand = rng(20260920);

  it('simplifyLang matches LineGeneralization, including the lookAhead == length case', () => {
    for (let run = 0; run < 400; run++) {
      const n = 1 + Math.floor(rand() * 12);
      const pts: Pt[] = [];
      let x = rand() * 600;
      let y = rand() * 300;
      for (let i = 0; i < n; i++) {
        if (rand() > 0.1) { x += rand() * 30 - 15; y += rand() * 30 - 15; }
        pts.push({ x, y });
      }
      const expected = ref.simplifyLang(5, 10, pts).flatMap((p) => [p.x, p.y]);
      expect(simplifyLang(pts.flatMap((p) => [p.x, p.y]), 5, 10)).toEqual(expected);
    }
  });

  it('a whole gesture commits the reference points, on the 600px canvas and on a wider document', () => {
    for (let run = 0; run < 300; run++) {
      const g = gesture(rand);
      const expected = referenceCommit(ref, g).flatMap((p) => [p.x, p.y]);
      expect(ourCommit(g)).toEqual(expected.map((v) => Math.round(v * FIXED_POINT_SCALE)));

      // A 1280-wide document: the same gesture, the same share of the picture.
      const wide = ourCommit(g, CANVAS_LOGICAL_WIDTH);
      expect(wide.length).toBe(expected.length);
      for (let i = 0; i < wide.length; i++) {
        expect(Math.abs(wide[i] * (600 / CANVAS_LOGICAL_WIDTH) / FIXED_POINT_SCALE - expected[i]))
          .toBeLessThan(0.1);
      }
    }
  });

  it('a committed line rasterizes through the same path as DrawField.multicurve', () => {
    for (let run = 0; run < 300; run++) {
      const g = gesture(rand);
      const points = ourCommit(g);
      const asPts: Pt[] = [];
      for (let i = 0; i < points.length; i += 2) asPts.push({ x: points[i], y: points[i + 1] });
      const tool: ToolDescriptor = { kind: 'pencil', geometry: 'smooth', width: 32, color: '#000000' };
      const frame: Frame = { strokes: [{ points, tool_id: 0 }] };
      const ctx = new ShapeRecorder();
      renderStrokesLayer(frame, [tool], ctx, { scale: 1, dpr: 1 });

      // Frame.addSpline: one point, or two equal ones, is a circle of the pen's radius.
      const dot = asPts.length === 1 || (asPts.length === 2 && asPts[0].x === asPts[1].x && asPts[0].y === asPts[1].y);
      if (dot) {
        expect(ctx.ops).toEqual(['circle']);
        continue;
      }
      const expected = ref.multicurve(asPts, false);
      const ours = new PathRecorder();
      emitGeometry(points, 'smooth', false, ours);
      expect(ours.ops).toEqual(expected);
      expect(ctx.ops).toEqual(expected);
    }
  });
});
