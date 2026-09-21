/**
 * What a brush type looks like, drawn by the engine that draws it for real.
 *
 * The box in the brush panel shows a sample of each type, and the sample is
 * not an illustration: a canned gesture goes through the same session the
 * pointer goes through — the type's own brush, its canvas, its smoothing and
 * its commit — and the path the renderer would emit for the result is handed
 * back as SVG. A brush that changes how it draws changes its own picture.
 */

import { plugins } from '../plugins';
import { PENCIL } from '../plugins/builtins';
import { presetBrushRules } from '../plugins/brushes';
import { emitPathForTool, isContourTool, isStampTool } from '../render/dispatch';
import type { PathSink } from '../render/smoothing';
import { PointerStrokeController } from '../tools/profiles';
import { brushWidthDoc } from '../tools/stroke-builder';
import type { BrushId, TonioBrush } from './presets';

/** The sample box, in document units. */
export const PREVIEW_BOX = { width: 768, height: 192 };

/**
 * The canned gesture: a wave and a half, drawn by a hand that starts out slow
 * and speeds up — the points crawl at the left edge and race at the right.
 *
 * One pace would hide half of what there is to see: both smoothing numbers
 * work on points that land close together, so a sample drawn at a single
 * speed either survives them whole or collapses whole. With the pace changing
 * along the way, the slow half shows the thinning at work while the fast half
 * keeps the shape — which is also what tells the brushes apart, since each
 * simplifies by its own rule.
 */
export const PREVIEW_GESTURE: readonly number[] = buildSample();

function buildSample(): number[] {
  const points: number[] = [];
  const start = PREVIEW_BOX.width * 0.08;
  const span = PREVIEW_BOX.width * 0.84;
  /** Document units between points where the hand crawls, and where it races. */
  const slow = 4;
  const fast = 40;
  const wave = (t: number) => PREVIEW_BOX.height / 2 - Math.sin(t * Math.PI * 3) * 56;
  for (let x = 0; x < span; x += slow + (fast - slow) * (x / span)) {
    points.push(start + x, wave(x / span));
  }
  points.push(start + span, wave(1));
  return points;
}

export interface BrushPreview {
  /** SVG path data in the box's coordinates; empty when there is no line to show. */
  d: string;
  /** Stroke width in the same units; 0 for a contour, which is filled. */
  width: number;
  /** A closed contour is filled, a line is stroked. */
  fill: boolean;
}

/**
 * The sample of one brush: that brush of the register, on the canvas the
 * preset would hand it, at the width the sliders are set to.
 */
export function brushPreview(
  tool: string,
  brush: BrushId,
  widthLogical: number,
  tonio: TonioBrush,
): BrushPreview {
  const stroke = plugins.tool(tool)?.stroke ?? PENCIL;
  const rules = stroke.rules?.() ?? presetBrushRules(brush, tonio);
  const descriptor = stroke.descriptor({
    width: brushWidthDoc(widthLogical),
    color: '#000000',
    fill: '#ffffff',
  });
  const pointer = new PointerStrokeController(() => ({
    descriptor,
    rules,
    // The sample is written in document units of its own box, so there is
    // nothing to normalise: it is the shape of the line that is on show.
    coordinateScale: 1,
    zoom: 1,
  }));
  for (let i = 0; i < PREVIEW_GESTURE.length; i += 2) {
    const sample = { pointerId: 1, isPrimary: true, x: PREVIEW_GESTURE[i], y: PREVIEW_GESTURE[i + 1] };
    if (i === 0) pointer.pointerDown(sample);
    else if (i === PREVIEW_GESTURE.length - 2) pointer.pointerUp(sample);
    else pointer.pointerMove(sample);
  }
  const committed = pointer.takeCommitted();
  // A brush that stamps a mark per point draws no line at all: a path through
  // the cells it filled would be a picture of something it never makes.
  if (!committed || isStampTool(committed.tool)) {
    return { d: '', width: 0, fill: false };
  }
  const path = new SvgPath();
  emitPathForTool(committed.points, committed.tool, path);
  const fill = isContourTool(committed.tool);
  return {
    d: fill ? `${path}Z` : String(path),
    width: 'width' in committed.tool ? committed.tool.width : 0,
    fill,
  };
}

/** The renderer's path, written out as SVG instead of onto a canvas. */
class SvgPath implements PathSink {
  #parts: string[] = [];

  moveTo(x: number, y: number): void {
    this.#parts.push(`M${round(x)} ${round(y)}`);
  }

  lineTo(x: number, y: number): void {
    this.#start(x, y);
    this.#parts.push(`L${round(x)} ${round(y)}`);
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.#start(cpx, cpy);
    this.#parts.push(`Q${round(cpx)} ${round(cpy)} ${round(x)} ${round(y)}`);
  }

  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    this.#start(c1x, c1y);
    this.#parts.push(
      `C${round(c1x)} ${round(c1y)} ${round(c2x)} ${round(c2y)} ${round(x)} ${round(y)}`,
    );
  }

  /**
   * The Tonio emitter opens with a curve and no `moveTo`, because a canvas
   * starts a subpath at the control point by itself. SVG does not, so the
   * same move is written out here.
   */
  #start(x: number, y: number): void {
    if (this.#parts.length === 0) this.moveTo(x, y);
  }

  toString(): string {
    return this.#parts.join('');
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
