/**
 * The stroke engine: one gesture, one path.
 *
 * Numbers are logical pixels of the document, and nothing here rescales them
 * by its size: a pixel is a pixel, so a brush set to 9 lays a nine-pixel line
 * in a document of any shape.
 *
 * Everything that differs between brushes — how the pointer's samples are
 * collected, what the release event
 * contributes, how the points are thinned, how they are laid down for the
 * reader, and whether a cancelled gesture still lands — arrives here as plain
 * functions in a `StrokeRules` and is run without being named. There is no
 * branch in this file for any particular brush, and none for any drawing
 * application: a preset picks a brush, and the brush brings its rules.
 */

import { MAX_STROKE_COORDS, MAX_STROKE_WIDTH } from '../format/constants';
import { clampCoord } from '../model/geom';
import type { LineToolDescriptor, StrokeGeometry } from '../format/types';
import { DOCUMENT_PRIMITIVES } from '../render/dispatch';
import { pressureAlong, pressureWidth } from '../render/pressure';
import type { ResolvedStroke } from '../model/operations';
import { t } from '../i18n';

export interface PointerSample {
  pointerId: number;
  isPrimary: boolean;
  /** Float coordinates in fixed-point document units. */
  x: number;
  y: number;
  /** Pen pressure 0..1 — only a pen reports it, and only when the setting is on. */
  pressure?: number;
  /** Already unpacked coalesced samples, when supported. */
  coalesced?: PointerSample[];
}

/**
 * A width as the format stores it: whole document units inside the range the
 * schema takes. A pixel is a pixel — the size of the document it lands on is
 * not in this arithmetic, so the same brush draws the same line wherever it
 * is used.
 */
export function storedStrokeWidth(width: number): number {
  return Math.min(MAX_STROKE_WIDTH, Math.max(1, Math.round(width)));
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
) => ResolvedStroke;

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
  /**
   * What this batch of pointer samples adds to the line — not the line
   * rebuilt. `line` is what has been collected so far, for a rule that needs
   * to look at it; writing into it the rule MUST NOT.
   */
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
  prepare?(points: readonly number[], width: number, zoom: number): number[];
  /**
   * Lays the collected points down as the descriptor's `geometry` reads them.
   * The same function runs for the line under the hand and for the committed
   * stroke, so a brush cannot show one line and store another. Absent means
   * the points already are the geometry.
   */
  path?(points: readonly number[]): number[];
  /**
   * What the release event contributes — again, the addition and not the
   * line. Absent means "the same as any other event": one brush leaves a
   * gesture that never moved as a dot, another takes nothing from the release
   * at all, which is an empty addition.
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
  /** Viewport zoom frozen at pointerdown — a brush's threshold may divide by it. */
  readonly zoom: number;
  /**
   * The pen's own samples `[x, y, p, …]`, before any brush rule saw them —
   * a brush thins and relays points by its own rules, so the pressure is laid
   * onto whatever it keeps afterwards. Empty for a mouse or a finger.
   */
  readonly pressureSamples: number[];
}

export function beginStrokeSession(
  event: PointerSample,
  descriptor: LineToolDescriptor,
  rules: StrokeRules,
  zoom = 1,
): StrokeSession {
  const session: StrokeSession = {
    pointerId: event.pointerId,
    descriptor: { ...descriptor, width: storedStrokeWidth(descriptor.width) },
    rawPoints: [],
    pressureSamples: [],
    rules,
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
  // A pen lifts with zero pressure — that is the lift, not how hard it drew.
  const lift = (sample: PointerSample): PointerSample => ({ ...sample, pressure: undefined });
  collect(
    session,
    { ...lift(event), coalesced: event.coalesced?.map(lift) },
    session.rules.release ?? session.rules.capture,
  );
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
    return withPressure(commit(session.rawPoints, session.descriptor), session);
  }
  const thinned = prepare
    ? prepare(session.rawPoints, session.descriptor.width, session.zoom)
    : session.rawPoints.slice();
  return withPressure({ points: path ? path(thinned) : thinned, tool: { ...session.descriptor } }, session);
}

/**
 * The pen's pressure at each point of the line under the hand, or undefined
 * when the gesture has none or its tool has no line width to vary.
 */
export function previewStrokePressure(
  session: StrokeSession,
  points: readonly number[],
): number[] | undefined {
  const { kind } = session.descriptor;
  if (!feelsPressure(session) || points.length < 2 || kind === 'stamp') return undefined;
  return pressureAlong(points, session.pressureSamples);
}

/**
 * Whether the pen measured its pressure at all. Hardware that cannot sense it
 * reports 0.5 for as long as it touches (Pointer Events), and that is not a
 * half press: read as one, the line landed at 57.5 % of the width in the box.
 */
export function feelsPressure(session: StrokeSession): boolean {
  const samples = session.pressureSamples;
  for (let i = 2; i < samples.length; i += 3) {
    if (samples[i] !== 0.5) return true;
  }
  return false;
}

/**
 * Lays the pen's pressure onto the committed points. Only a line with a width
 * takes it — a stamp's marks and a contour's baked ring do not. A pressure
 * that never changed is not stored: it is the tool's width, scaled once.
 */
function withPressure(stroke: ResolvedStroke, session: StrokeSession): ResolvedStroke {
  const tool = stroke?.tool;
  if (!feelsPressure(session) || !tool
    || (tool.kind !== 'pencil' && tool.kind !== 'eraser' && tool.kind !== 'feather')
    || !Array.isArray(stroke.points) || stroke.points.length < 2) {
    return stroke;
  }
  const pressure = pressureAlong(stroke.points, session.pressureSamples);
  if (pressure.every((q) => q === pressure[0])) {
    return { ...stroke, tool: { ...tool, width: storedStrokeWidth(pressureWidth(tool.width, pressure[0])) } };
  }
  return { ...stroke, pressure };
}

export class PointerStrokeController {
  #session: StrokeSession | null = null;
  #committed: ResolvedStroke | null = null;

  constructor(
    private readonly selection: () => {
      descriptor: LineToolDescriptor;
      rules: StrokeRules;
      zoom?: number;
    },
  ) {}

  get session(): StrokeSession | null { return this.#session; }

  pointerDown(event: PointerSample): boolean {
    if (!event.isPrimary || this.#session) return false;
    const selected = this.selection();
    this.#session = beginStrokeSession(event, selected.descriptor, selected.rules, selected.zoom ?? 1);
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
      console.error(t('brush.unknown_kind', { kind: String(kind) }));
      return null;
    }
    // The document stores whole coordinates inside int16. A brush quantizes on
    // its own way, but one that hands back whatever the pointer gave would cost
    // the whole stroke to a fraction — or, drawn out over the table at 10 %,
    // to a point past the format's range.
    return fitFormat({ ...stroke, points: stroke.points.map((v) => clampCoord(Math.round(v))) });
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
 *
 * The rule returns what this batch adds, and the engine appends it. Returning
 * the whole line instead would copy it on every event — quadratic in the
 * length of the stroke, which is felt as a line that lags the further it is
 * drawn. Appended one by one rather than by spread: a long line spread into
 * arguments runs into the engine's stack limit.
 */
function collect(
  session: StrokeSession,
  event: PointerSample,
  take: NonNullable<StrokeRules['capture']>,
): void {
  const coalesced = event.coalesced?.filter((sample) => sample.pointerId === session.pointerId);
  const samples = coalesced && coalesced.length > 0 ? coalesced : [event];
  const batch: number[] = [];
  for (const sample of samples) {
    batch.push(sample.x, sample.y);
    if (sample.pressure !== undefined) session.pressureSamples.push(sample.x, sample.y, sample.pressure);
  }
  const added = take(session.rawPoints, batch, session.descriptor.width);
  for (let i = 0; i < added.length; i++) {
    session.rawPoints.push(added[i]);
  }
}

/**
 * A stroke over the format's point limit is cut rather than lost; its last
 * point replaces the cut tail, and the pen pressure is cut along with it.
 */
function fitFormat(stroke: ResolvedStroke): ResolvedStroke {
  const { points, pressure } = stroke;
  if (points.length <= MAX_STROKE_COORDS) {
    return stroke;
  }
  const keep = MAX_STROKE_COORDS / 2 - 1;
  const cut: ResolvedStroke = { ...stroke, points: [...points.slice(0, keep * 2), ...points.slice(-2)] };
  if (pressure) {
    cut.pressure = [...pressure.slice(0, keep), pressure[pressure.length - 1]];
  }
  return cut;
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}
