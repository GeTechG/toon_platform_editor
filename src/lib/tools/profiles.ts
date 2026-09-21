/**
 * The stroke engine: one gesture, one path.
 *
 * Everything that differs between brushes — how the pointer's samples are
 * collected, what the release event
 * contributes, how the points are thinned, how they are laid down for the
 * reader, and whether a cancelled gesture still lands — arrives here as plain
 * functions in a `StrokeRules` and is run without being named. There is no
 * branch in this file for any particular brush, and none for any drawing
 * application: a preset picks a brush, and the brush brings its rules.
 */

import { CANVAS_LOGICAL_WIDTH, MAX_STROKE_WIDTH } from '../format/constants';
import type { LineToolDescriptor, StrokeGeometry } from '../format/types';
import { DOCUMENT_PRIMITIVES } from '../render/dispatch';
import type { ResolvedStroke } from '../model/operations';

export interface PointerSample {
  pointerId: number;
  isPrimary: boolean;
  /** Float coordinates in fixed-point document units. */
  x: number;
  y: number;
  /** Already unpacked coalesced samples, when supported. */
  coalesced?: PointerSample[];
}

/**
 * A brush width is a pixel of the editor's logical canvas — one canvas for
 * every brush, whoever's line it reproduces — so on a document of another
 * size it is divided by this scale, the same normalisation the thinning
 * thresholds get.
 */
export function documentCoordinateScale(documentLogicalWidth: number): number {
  return CANVAS_LOGICAL_WIDTH / positive(documentLogicalWidth);
}

/** That width in document units, kept inside what the format can store. */
export function strokeWidthOnCanvas(width: number, coordinateScale: number): number {
  const scaled = Math.round(width / positive(coordinateScale));
  return Math.min(MAX_STROKE_WIDTH, Math.max(1, scaled));
}

/**
 * The rule that turns a gesture's points into what lands in the frame. A brush
 * that has one owns its stroke end to end and may hand back a descriptor of
 * another kind than the one it drew with — a line captured, a closed contour
 * committed. Plain function, not a manifest: the engine knows strokes, never
 * the register.
 */
export type StrokeCommit = (
  points: readonly number[],
  descriptor: LineToolDescriptor,
  ctx: StrokeCommitContext,
) => ResolvedStroke;

/** What the engine knows at the end of a gesture that the brush cannot see. */
export interface StrokeCommitContext {
  /**
   * Document normalisation frozen at `pointerdown`: a threshold written in
   * pixels of the logical canvas is scaled by it.
   */
  readonly coordinateScale: number;
}

/**
 * A brush's own rules for turning a gesture into stored points.
 *
 * Plain functions and numbers, never a manifest: the stroke engine takes these
 * and runs one path, so it never learns whose rules it is running. A tool that
 * declares none draws by the rules of the brush its preset picked.
 */
export interface StrokeRules {
  /**
   * What a width may be, in pixels of the editor's logical canvas. Absent
   * means "whatever the preset's UX profile allows" — the editor holds no
   * table of ceilings per brush.
   */
  readonly range?: { readonly min: number; readonly max: number };
  /** What a fresh record of this brush starts at. */
  readonly defaults?: { readonly width: number; readonly smooth: number; readonly minDistance: number };
  /** Whether the smoothing pair reaches this brush at all. */
  readonly smoothing?: boolean;
  /** Folds a batch of pointer samples into the points collected so far. */
  capture(line: readonly number[], batch: readonly number[], width: number): number[];
  /** The line under the hand, before the thinning the commit does. */
  preview?(points: readonly number[]): number[];
  /**
   * How the line under the hand is read, when that differs from the stored
   * stroke's own geometry — one brush shows the raw polyline while it is being
   * drawn and only curves it on release.
   */
  readonly previewGeometry?: StrokeGeometry;
  /** Thins the collected points when the gesture ends. */
  prepare?(
    points: readonly number[],
    width: number,
    zoom: number,
    documentScale: number,
  ): number[];
  /**
   * Lays the collected points down as the descriptor's `geometry` reads them.
   * The same function runs for the line under the hand and for the committed
   * stroke, so a brush cannot show one line and store another. Absent means
   * the points already are the geometry.
   */
  path?(points: readonly number[]): number[];
  /**
   * What the release event contributes. Absent means "the same as any other
   * event": one brush leaves a gesture that never moved as a dot, another
   * takes nothing from the release at all.
   */
  release?(line: readonly number[], batch: readonly number[], width: number): number[];
  /** A cancelled gesture still lands in the frame. */
  readonly commitOnCancel?: boolean;
  /** What the collected points become; absent means "the points, as prepared". */
  readonly commit?: StrokeCommit;
}

export interface StrokeSession {
  readonly pointerId: number;
  /** The line tool the gesture is drawn with (a brush's own commit may change its kind). */
  readonly descriptor: LineToolDescriptor;
  /** The points the brush has collected so far, in document units. */
  readonly rawPoints: number[];
  /** The brush's rules, frozen at `pointerdown` along with everything else. */
  readonly rules: StrokeRules;
  readonly coordinateScale: number;
  /** Viewport zoom frozen at pointerdown — a brush's threshold may divide by it. */
  readonly zoom: number;
}

export function beginStrokeSession(
  event: PointerSample,
  descriptor: LineToolDescriptor,
  rules: StrokeRules,
  coordinateScale = 1,
  zoom = 1,
): StrokeSession {
  const scale = positive(coordinateScale);
  const session: StrokeSession = {
    pointerId: event.pointerId,
    // A width is a pixel of the logical canvas, so the stroke covers the
    // same share of the picture on a document of any size.
    descriptor: { ...descriptor, width: strokeWidthOnCanvas(descriptor.width, scale) },
    rawPoints: [],
    rules,
    coordinateScale: scale,
    zoom: positive(zoom),
  };
  collect(session, event, rules.capture);
  return session;
}

/**
 * A stroke started with a button other than the left one draws with the fill
 * colour, the way the reference swaps `c.c` and `c.f` for the gesture.
 * The pencil carries no fill of its own, so the editor's one comes in.
 */
export function swapStrokeColours(tool: LineToolDescriptor, fill: string): LineToolDescriptor {
  // By what the descriptor carries, not by which tool it is: one that has both
  // trades them, one that only paints takes the fill as its colour, and an
  // eraser, which has neither, is left alone.
  if ('fill' in tool) {
    return { ...tool, color: tool.fill, fill: tool.color };
  }
  return 'color' in tool ? { ...tool, color: fill } : tool;
}

export function appendStrokeEvent(session: StrokeSession, event: PointerSample): void {
  if (!event.isPrimary || event.pointerId !== session.pointerId) return;
  collect(session, event, session.rules.capture);
}

/**
 * What the release event contributes is the brush's business: one takes its
 * point like any other, one leaves a gesture that never moved as a dot, and
 * one takes nothing at all.
 */
export function finishStrokeEvent(session: StrokeSession, event: PointerSample): void {
  if (!event.isPrimary || event.pointerId !== session.pointerId) return;
  collect(session, event, session.rules.release ?? session.rules.capture);
}

/**
 * The line under the hand. It goes through the brush's own lay-down, the same
 * one the commit uses, so a brush cannot show one line and store another; what
 * it may differ by is thinning, which is what `preview` is for.
 */
export function previewStrokeSession(session: StrokeSession): readonly number[] {
  const { preview, path } = session.rules;
  const points = preview ? preview(session.rawPoints) : session.rawPoints;
  return path ? path(points) : points;
}

export function commitStrokeSession(session: StrokeSession): ResolvedStroke {
  const { commit, prepare, path } = session.rules;
  // The brush's own rule, when it has one: it owns the stroke end to end and
  // may hand back a kind other than the one it drew with.
  if (commit) {
    return commit(session.rawPoints, session.descriptor, {
      coordinateScale: session.coordinateScale,
    });
  }
  const thinned = prepare
    ? prepare(session.rawPoints, session.descriptor.width, session.zoom, session.coordinateScale)
    : session.rawPoints.slice();
  return { points: path ? path(thinned) : thinned, tool: { ...session.descriptor } };
}

export class PointerStrokeController {
  #session: StrokeSession | null = null;
  #committed: ResolvedStroke | null = null;

  constructor(
    private readonly selection: () => {
      descriptor: LineToolDescriptor;
      rules: StrokeRules;
      coordinateScale?: number;
      zoom?: number;
    },
  ) {}

  get session(): StrokeSession | null { return this.#session; }

  pointerDown(event: PointerSample): boolean {
    if (!event.isPrimary || this.#session) return false;
    const selected = this.selection();
    this.#session = beginStrokeSession(
      event,
      selected.descriptor,
      selected.rules,
      selected.coordinateScale,
      selected.zoom ?? 1,
    );
    return true;
  }

  pointerMove(event: PointerSample): boolean {
    if (!this.#session || !event.isPrimary || event.pointerId !== this.#session.pointerId) return false;
    appendStrokeEvent(this.#session, event);
    return true;
  }

  pointerUp(event: PointerSample): boolean {
    if (!this.#session || !event.isPrimary || event.pointerId !== this.#session.pointerId) return false;
    finishStrokeEvent(this.#session, event);
    this.#committed = this.#commit(this.#session);
    this.#session = null;
    return true;
  }

  /**
   * A stroke reaches the frame only if the format knows its kind. A brush
   * commits by its own rule, and a rule that hands back something the renderer
   * cannot draw would make a frame nobody but this editor could show — so the
   * stroke is dropped with a reason instead.
   */
  #commit(session: StrokeSession): ResolvedStroke | null {
    const stroke = commitStrokeSession(session);
    const kind = (stroke?.tool as { kind?: unknown } | undefined)?.kind;
    if (!(DOCUMENT_PRIMITIVES as readonly unknown[]).includes(kind)) {
      console.error(`кисть вернула вид, которого формат не знает: ${String(kind)}`);
      return null;
    }
    // The document stores whole coordinates. A brush quantizes on its own way,
    // but one that hands back whatever the pointer gave would cost the whole
    // stroke to a fraction.
    return { ...stroke, points: stroke.points.map(Math.round) };
  }

  pointerCancel(event: PointerSample): boolean {
    if (!this.#session || !event.isPrimary || event.pointerId !== this.#session.pointerId) return false;
    if (this.#session.rules.commitOnCancel) {
      this.#committed = this.#commit(this.#session);
    }
    this.#session = null;
    return true;
  }

  /**
   * Drops the session without committing it, unlike `pointerCancel`, which
   * still lands the stroke of a brush that asked for it. A second finger on
   * the canvas means the first one was reaching for a gesture, not drawing.
   */
  discard(): boolean {
    if (!this.#session) return false;
    this.#session = null;
    return true;
  }

  takeCommitted(): ResolvedStroke | null {
    const stroke = this.#committed;
    this.#committed = null;
    return stroke;
  }
}

/**
 * Hands one pointer event to the brush as a flat batch of samples: the
 * coalesced ones a browser held back, or the event itself when there are none.
 * Which of them end up in the line is the brush's rule, not the engine's.
 */
function collect(
  session: StrokeSession,
  event: PointerSample,
  take: NonNullable<StrokeRules['capture']>,
): void {
  const coalesced = event.coalesced?.filter((sample) => sample.pointerId === session.pointerId);
  const samples = coalesced && coalesced.length > 0 ? coalesced : [event];
  const batch: number[] = [];
  for (const sample of samples) batch.push(sample.x, sample.y);
  const collected = take(session.rawPoints, batch, session.descriptor.width);
  session.rawPoints.length = 0;
  session.rawPoints.push(...collected);
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}
