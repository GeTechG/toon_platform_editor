/**
 * The ruler: a straight guide lying on the sheet, the studio's alone — it is
 * never in the document. Where it lies is in sheet (document) units, so it
 * stays put under a zoom or a pan; how thick it is and how near a press must
 * be to catch it are screen pixels, the same at every zoom. Pure, so
 * `bun test` runs it; the canvas draws it and feeds it presses.
 */

export interface Ruler {
  /** The middle of the ruler, in document units. */
  readonly x: number;
  readonly y: number;
  /** Radians, clockwise from lying flat (the sheet's y runs down). */
  readonly angle: number;
  /** End to end, in document units. */
  readonly length: number;
}

type Point = readonly [number, number];

/** The body across, in screen pixels. */
export const RULER_THICKNESS_PX = 36;
/** How far past an edge a press still lays a line along it, in screen pixels. */
export const RULER_CATCH_PX = 24;
/** The stretch at each end that turns the ruler instead of moving it, in screen pixels. */
export const RULER_END_PX = 28;

export type RulerHit =
  | { readonly part: 'body' }
  /** +1 is the end the angle points to, −1 the other. */
  | { readonly part: 'end'; readonly end: 1 | -1 }
  | { readonly part: 'edge' };

/** The point in the ruler's own frame: along it from the middle, and across it. */
function local(ruler: Ruler, [px, py]: Point): { along: number; across: number } {
  const dx = px - ruler.x;
  const dy = py - ruler.y;
  const cos = Math.cos(ruler.angle);
  const sin = Math.sin(ruler.angle);
  return { along: dx * cos + dy * sin, across: -dx * sin + dy * cos };
}

/**
 * What a press at `point` takes. `unitsPerPx` is how many document units one
 * screen pixel spans at the zoom in hand.
 */
export function hitRuler(ruler: Ruler, point: Point, unitsPerPx: number): RulerHit | null {
  const { along, across } = local(ruler, point);
  const half = ruler.length / 2;
  if (Math.abs(along) > half) {
    return null;
  }
  const edge = (RULER_THICKNESS_PX / 2) * unitsPerPx;
  if (Math.abs(across) <= edge) {
    if (Math.abs(along) >= half - RULER_END_PX * unitsPerPx) {
      return { part: 'end', end: along > 0 ? 1 : -1 };
    }
    return { part: 'body' };
  }
  if (Math.abs(across) <= edge + RULER_CATCH_PX * unitsPerPx) {
    return { part: 'edge' };
  }
  return null;
}

/**
 * Where a line begun at `press` beside the ruler lays each of its points: on
 * the line through the press that runs parallel to the ruler, as a pencil
 * held against a real one runs along its edge at the same distance.
 */
export function alongRuler(ruler: Ruler, press: Point): (point: Point) => [number, number] {
  const cos = Math.cos(ruler.angle);
  const sin = Math.sin(ruler.angle);
  return ([x, y]) => {
    const t = (x - press[0]) * cos + (y - press[1]) * sin;
    return [press[0] + t * cos, press[1] + t * sin];
  };
}

/** The ruler carried by a drag of its body from `from` to `to`. */
export function movedRuler(ruler: Ruler, from: Point, to: Point): Ruler {
  return { ...ruler, x: ruler.x + to[0] - from[0], y: ruler.y + to[1] - from[1] };
}

/** The step the ruler turns by with Shift held, and the angles a finger is pulled to. */
const TURN_STEP = Math.PI / 12;
/**
 * How near a step a finger is pulled onto it, in screen pixels where the
 * finger is: a finger has no Shift (owner, 2026-11-16), and by hand 0° or 45°
 * is never quite hit. In pixels, not degrees, so the pull under the finger is
 * the same at every zoom (owner, the same day) — but never more than
 * `TURN_PULL_MAX`, or a finger near the fixed end would always land on a step.
 */
const TURN_PULL_PX = 40;
const TURN_PULL_MAX = (5 * Math.PI) / 180;

/**
 * How a turn lands: `step` (Shift) lays the angle on 15°, `pull` (a finger)
 * pulls it onto such a step when it is within `TURN_PULL_PX` of it, `free` (a
 * mouse or a pen) leaves it be.
 */
export type TurnSnap = 'step' | 'pull' | 'free';

/**
 * The ruler with its `end` dragged to `to`: it turns about the other end and
 * keeps its length, its angle landing as `snap` says. `unitsPerPx` — sheet
 * units one screen pixel spans at the zoom in hand — measures the pull.
 */
export function turnedRuler(ruler: Ruler, end: 1 | -1, to: Point, snap: TurnSnap, unitsPerPx = 1): Ruler {
  const half = ruler.length / 2;
  const fixedX = ruler.x - end * half * Math.cos(ruler.angle);
  const fixedY = ruler.y - end * half * Math.sin(ruler.angle);
  // The way from the fixed end to the dragged one; the angle points to +1.
  let toward = Math.atan2(to[1] - fixedY, to[0] - fixedX);
  const nearest = Math.round(toward / TURN_STEP) * TURN_STEP;
  // The finger's distance from the fixed end, on the screen: an angle off by
  // so much puts it that many pixels times the angle away from the step.
  const reach = Math.hypot(to[0] - fixedX, to[1] - fixedY) / unitsPerPx;
  const pull = Math.min(TURN_PULL_MAX, TURN_PULL_PX / Math.max(reach, 1));
  if (snap === 'step' || (snap === 'pull' && Math.abs(toward - nearest) <= pull)) {
    toward = nearest;
  }
  const angle = end === 1 ? toward : toward + Math.PI;
  return {
    ...ruler,
    angle: Math.atan2(Math.sin(angle), Math.cos(angle)),
    x: fixedX + half * Math.cos(toward),
    y: fixedY + half * Math.sin(toward),
  };
}

/** The share of the sheet's width in view the ruler spans when first laid. */
const FIRST_SPAN = 0.8;

/**
 * Where the ruler is first laid: flat, through the middle of the part of the
 * sheet in view (`view` in document units, the table beside the sheet left
 * out), over most of that part's width.
 */
export function rulerAcross(
  view: { left: number; top: number; right: number; bottom: number },
  width: number,
  height: number,
): Ruler {
  const left = Math.max(0, Math.min(width, view.left));
  const right = Math.max(left, Math.min(width, view.right));
  const top = Math.max(0, Math.min(height, view.top));
  const bottom = Math.max(top, Math.min(height, view.bottom));
  // A view off the sheet altogether lays it across the sheet itself.
  const [l, r, t, b] = right - left > 0 && bottom - top > 0 ? [left, right, top, bottom] : [0, width, 0, height];
  return { x: (l + r) / 2, y: (t + b) / 2, angle: 0, length: Math.round(FIRST_SPAN * (r - l)) };
}
