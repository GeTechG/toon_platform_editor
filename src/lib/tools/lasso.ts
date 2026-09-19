/**
 * The lasso and the transform session it opens (toonio.bundle.js `Lasso`):
 * Q takes the whole frame on every selected layer, its bounding box gets the
 * eight handles, and every drag, field and hotkey accumulates into one set of
 * parameters. Nothing is written to the document until the session is
 * applied, so Esc is free and Enter is a single undo step.
 *
 * Pure data and pure functions — the Svelte components only hold the session
 * and draw it.
 */

import type { Box, Matrix } from '../model/geom';
import { transformMatrix } from '../model/geom';

export interface SelectableStroke {
  points: readonly number[];
}

/** What the transform window edits: one accumulated transform of the selection. */
export interface TransformSession {
  dx: number;
  dy: number;
  /** Degrees, clockwise on screen. */
  rotate: number;
  scaleX: number;
  scaleY: number;
}

export const EMPTY_TRANSFORM: TransformSession = { dx: 0, dy: 0, rotate: 0, scaleX: 1, scaleY: 1 };

/** What the pointer is over: which handle, the body, the turning ring, or nothing. */
export type HitMode =
  | 'move'
  | 'rotate'
  | 'scale-u'
  | 'scale-d'
  | 'scale-l'
  | 'scale-r'
  | 'scale-ul'
  | 'scale-ur'
  | 'scale-dl'
  | 'scale-dr'
  | 'none';

/** Reference nudge steps: arrows 1 (shift 10), Q/W 1° (shift 15°), +/- 1% (shift 5%). */
const MOVE_STEP = 1;
const MOVE_STEP_SHIFT = 10;
const ROTATE_STEP = 1;
const ROTATE_STEP_SHIFT = 15;
const SCALE_STEP = 0.01;
const SCALE_STEP_SHIFT = 0.05;
/** A selection scaled to nothing can never be grown back, so it never gets there. */
const SCALE_MIN = 0.01;
/** Reference hit thresholds, in screen pixels: handles, and the ring outside a corner. */
const HANDLE_PX = 10;
const ROTATE_PX = 50;
/** Ctrl while turning snaps to this many degrees. */
const ROTATE_SNAP = 15;

/** Axis-aligned box around the chosen strokes (null indices = all); null when empty. */
export function selectionBounds(
  strokes: readonly SelectableStroke[],
  indices: readonly number[] | null = null,
): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const index of indices ?? strokes.map((_, i) => i)) {
    const stroke = strokes[index];
    if (!stroke) {
      continue;
    }
    for (let i = 0; i < stroke.points.length; i += 2) {
      minX = Math.min(minX, stroke.points[i]);
      maxX = Math.max(maxX, stroke.points[i]);
      minY = Math.min(minY, stroke.points[i + 1]);
      maxY = Math.max(maxY, stroke.points[i + 1]);
    }
  }
  if (minX === Infinity) {
    return null;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The session as an affine transform about the centre of the selection box. */
export function sessionMatrix(session: TransformSession, box: Box): Matrix {
  return transformMatrix(session, box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * Factor the stroke width is multiplied by when "change width with scale" is
 * on: the smaller of the axis scales, unsigned — a mirror does not thin a
 * line, and a stretch on one axis alone does not fatten it (`tools.js:1861`).
 */
export function sessionWidthScale(session: TransformSession): number {
  return Math.min(Math.abs(session.scaleX), Math.abs(session.scaleY));
}

/** Where the frame sits now: its centre and half-extents after the session. */
function frameGeometry(box: Box, session: TransformSession) {
  return {
    cx: box.x + box.width / 2 + session.dx,
    cy: box.y + box.height / 2 + session.dy,
    hw: Math.abs((box.width / 2) * session.scaleX),
    hh: Math.abs((box.height / 2) * session.scaleY),
  };
}

/** A document point in the frame's own coordinates — centred and un-turned. */
function toLocal(x: number, y: number, cx: number, cy: number, rotate: number): [number, number] {
  const a = (-rotate * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
}

/**
 * What a press at (x, y) would do. `zoom` is screen pixels per document unit,
 * so the reference's 10 px handles and 50 px turning ring stay the same size
 * on screen at any magnification. Checked in the reference's order: handles,
 * then the body, then the ring outside a corner.
 */
export function hitMode(
  x: number,
  y: number,
  box: Box,
  session: TransformSession,
  zoom: number,
): HitMode {
  const { cx, cy, hw, hh } = frameGeometry(box, session);
  const [lx, ly] = toLocal(x, y, cx, cy, session.rotate);
  const handle = HANDLE_PX / zoom;
  if (Math.abs(lx) <= hw + handle && Math.abs(ly) <= hh + handle) {
    const u = Math.abs(ly + hh) <= handle;
    const d = Math.abs(ly - hh) <= handle;
    const l = Math.abs(lx + hw) <= handle;
    const r = Math.abs(lx - hw) <= handle;
    const vertical = u ? 'u' : d ? 'd' : '';
    const horizontal = l ? 'l' : r ? 'r' : '';
    return vertical || horizontal
      ? (`scale-${vertical}${horizontal}` as HitMode)
      : 'move';
  }
  const corner = Math.hypot(Math.abs(lx) - hw, Math.abs(ly) - hh);
  return corner <= ROTATE_PX / zoom ? 'rotate' : 'none';
}

/**
 * The body dragged from `start` to `pos`. With shift the first dominant move
 * picks an axis and the drag stays on it until shift is let go; `axis` is
 * that lock, handed back for the next move.
 */
export function movedBy(
  base: TransformSession,
  start: { x: number; y: number },
  pos: { x: number; y: number },
  shift: boolean,
  axis: 'x' | 'y' | null,
): { session: TransformSession; axis: 'x' | 'y' | null } {
  let dx = pos.x - start.x;
  let dy = pos.y - start.y;
  let lock = shift ? axis : null;
  if (shift) {
    if (!lock && (dx !== 0 || dy !== 0)) {
      lock = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    }
    if (lock === 'x') {
      dy = 0;
    } else if (lock === 'y') {
      dx = 0;
    }
  }
  return { session: { ...base, dx: base.dx + dx, dy: base.dy + dy }, axis: lock };
}

/** The angle the pointer swept about the frame's centre; ctrl snaps it to 15°. */
export function rotatedTo(
  base: TransformSession,
  box: Box,
  start: { x: number; y: number },
  pos: { x: number; y: number },
  ctrl: boolean,
): TransformSession {
  const { cx, cy } = frameGeometry(box, base);
  const swept =
    Math.atan2(pos.y - cy, pos.x - cx) - Math.atan2(start.y - cy, start.x - cx);
  const rotate = base.rotate + (swept * 180) / Math.PI;
  return { ...base, rotate: ctrl ? ROTATE_SNAP * Math.trunc(rotate / ROTATE_SNAP) : rotate };
}

/**
 * A handle dragged from `start` to `pos`. The pointer is un-turned into the
 * frame's coordinates first, so a handle on a rotated selection still scales
 * along the selection's own axes; the travel counts double because the
 * opposite side moves too. Shift on a corner keeps the ratio the drag began
 * with.
 */
export function scaledBy(
  base: TransformSession,
  box: Box,
  mode: HitMode,
  start: { x: number; y: number },
  pos: { x: number; y: number },
  shift: boolean,
): TransformSession {
  const suffix = mode.startsWith('scale-') ? mode.slice(6) : '';
  const signX = suffix.includes('l') ? -1 : suffix.includes('r') ? 1 : 0;
  const signY = suffix.includes('u') ? -1 : suffix.includes('d') ? 1 : 0;
  const { cx, cy } = frameGeometry(box, base);
  const [sx, sy] = toLocal(start.x, start.y, cx, cy, base.rotate);
  const [px, py] = toLocal(pos.x, pos.y, cx, cy, base.rotate);
  let scaleX = base.scaleX;
  let scaleY = base.scaleY;
  // A selection with no extent on an axis cannot be scaled along it.
  if (signX && box.width > 0) {
    scaleX = base.scaleX + ((px - sx) * 2 * signX) / box.width;
  }
  if (signY && box.height > 0) {
    scaleY = base.scaleY + ((py - sy) * 2 * signY) / box.height;
  }
  if (shift && signX && signY && base.scaleX !== 0) {
    scaleY = scaleX * (base.scaleY / base.scaleX);
  }
  return { ...base, scaleX, scaleY };
}

/** One keyboard step: arrows move, Q/W rotate, +/- scale. */
export function nudged(
  session: TransformSession,
  what: 'move' | 'rotate' | 'scale',
  dir: 1 | -1,
  shift: boolean,
  axis: 'x' | 'y' = 'x',
): TransformSession {
  switch (what) {
    case 'move': {
      const step = dir * (shift ? MOVE_STEP_SHIFT : MOVE_STEP);
      return axis === 'x' ? { ...session, dx: session.dx + step } : { ...session, dy: session.dy + step };
    }
    case 'rotate':
      return { ...session, rotate: session.rotate + dir * (shift ? ROTATE_STEP_SHIFT : ROTATE_STEP) };
    case 'scale': {
      // The reference steps the larger axis and drags the other along in
      // proportion, so 200/100 % plus one step is 201/100.5 %.
      const step = dir * (shift ? SCALE_STEP_SHIFT : SCALE_STEP);
      const major = Math.max(Math.abs(session.scaleX), Math.abs(session.scaleY));
      if (major <= 0) {
        return session;
      }
      const factor = Math.max(SCALE_MIN, major + step) / major;
      return { ...session, scaleX: session.scaleX * factor, scaleY: session.scaleY * factor };
    }
  }
}
