import { FIXED_POINT_SCALE, LANG_TOLERANCE_DOC, MAX_STROKE_WIDTH } from '../format/constants';
import type { LineToolDescriptor, StrokeDialect } from '../format/types';
import type { ResolvedStroke } from '../model/operations';
import { StrokeBuilder } from './stroke-builder';
import { OLDSCHOOL_LANG_TOLERANCE_LOGICAL, commitOldschoolStroke } from './oldschool';

export interface PointerSample {
  pointerId: number;
  isPrimary: boolean;
  /** Float coordinates in fixed-point document units. */
  x: number;
  y: number;
  /** Already unpacked coalesced samples, when supported. */
  coalesced?: PointerSample[];
}

export interface TonioSettings {
  smooth: number;
  minDistance: number;
}

export const DEFAULT_TONIO_SETTINGS: Readonly<TonioSettings> = { smooth: 3, minDistance: 3 };
/** Native width of the source Tonio drawing canvas. */
export const TONIO_CANVAS_WIDTH = 1280;
/** Native width of the source Multator drawing canvas. */
export const MULTATOR_CANVAS_WIDTH = 600;

/**
 * A brush width is a pixel of the canvas its dialect was drawn on, so on a
 * document of another size it is divided by this scale — the same
 * normalisation `tonioPrepare` already applies to the minimum distance.
 */
export function canvasCoordinateScale(dialect: StrokeDialect, documentLogicalWidth: number): number {
  const reference = dialect === 'toonio' ? TONIO_CANVAS_WIDTH : MULTATOR_CANVAS_WIDTH;
  return reference / positiveScale(documentLogicalWidth);
}

/** That width in document units, kept inside what the format can store. */
export function strokeWidthOnCanvas(width: number, coordinateScale: number): number {
  const scaled = Math.round(width / positiveScale(coordinateScale));
  return Math.min(MAX_STROKE_WIDTH, Math.max(1, scaled));
}

export interface StrokeSession {
  readonly profile: StrokeDialect;
  readonly pointerId: number;
  /** The line tool the gesture is drawn with (an oldschool commit turns it into a contour). */
  readonly descriptor: LineToolDescriptor;
  readonly rawPoints: number[];
  readonly tonio: Readonly<TonioSettings>;
  readonly tonioCoordinateScale: number;
  /** Viewport zoom frozen at pointerdown — the reference divides m by it. */
  readonly zoom: number;
  readonly multator?: StrokeBuilder;
  /** Oldschool easter-egg pen: the Multator commit produces a filled contour. */
  readonly oldschool: boolean;
  /** Set when the tool collects its own points (see `OwnCapture`). */
  readonly own?: OwnCapture;
}

/**
 * A tool that collects the pointer's points itself instead of letting the
 * dialect do it. Such a session owns its points end to end: no smoothing of
 * the dialect touches them, and the commit is `prepare` alone.
 *
 * Plain functions, not a manifest: the engine knows primitives and gestures,
 * never the register. What fills this in is the caller (`CanvasView`), from
 * whatever tool is in hand.
 */
export interface OwnCapture {
  /** The canvas the points are measured on, whatever preset is active. */
  readonly dialect?: StrokeDialect;
  capture(line: readonly number[], points: readonly number[], width: number): number[];
  prepare?(points: readonly number[], width: number, zoom: number): number[];
}

export function beginStrokeSession(
  profile: StrokeDialect,
  event: PointerSample,
  descriptor: LineToolDescriptor,
  tonio: TonioSettings = DEFAULT_TONIO_SETTINGS,
  coordinateScale = 1,
  oldschool = false,
  zoom = 1,
  own?: OwnCapture,
): StrokeSession {
  // A tool may fix the canvas its numbers are on — its points are then its
  // own, not a line anybody else draws. Everything else, the feather included,
  // takes the profile the gesture started under: a preset is the algorithm,
  // and a feather on a Multator panel is a Multator line that happens to be
  // filled.
  const scale = positiveScale(coordinateScale);
  const fixed = own?.dialect;
  const base = { ...descriptor, dialect: fixed ?? profile } as LineToolDescriptor;
  // Both dialects measure a width on their own reference canvas, so the
  // stroke covers the same share of the picture on a document of any size.
  const frozenDescriptor = copyLineTool({ ...base, width: strokeWidthOnCanvas(base.width, scale) });
  // A tool that fixed its canvas is collected that way whatever preset holds
  // it: the other dialect's builder would reshape points it never made.
  const sessionProfile: StrokeDialect = fixed ?? profile;
  // The oldschool pen commits a closed contour, which carries one colour and
  // no fill — so the easter egg stays the pen's and the eraser's.
  const oldschoolPen = oldschool && frozenDescriptor.kind !== 'feather';
  if (sessionProfile === 'multator') {
    const builder = new StrokeBuilder({
      width: frozenDescriptor.width,
      color: frozenDescriptor.kind === 'pencil' ? frozenDescriptor.color : '#000000',
      erase: frozenDescriptor.kind === 'eraser',
    });
    builder.addPoint(event.x, event.y);
    return {
      profile: sessionProfile,
      pointerId: event.pointerId,
      descriptor: frozenDescriptor,
      rawPoints: builder.rawPoints as number[],
      tonio: { ...tonio },
      tonioCoordinateScale: scale,
      zoom: 1,
      multator: builder,
      oldschool: oldschoolPen,
      own,
    };
  }
  const session: StrokeSession = {
    profile: sessionProfile,
    pointerId: event.pointerId,
    descriptor: frozenDescriptor,
    rawPoints: [],
    tonio: { smooth: clampInteger(tonio.smooth, 1, 100), minDistance: clampInteger(tonio.minDistance, 0, 30) },
    tonioCoordinateScale: scale,
    zoom: positiveScale(zoom),
    oldschool: false,
    own,
  };
  appendTonioEventBatch(session, event);
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
  if (session.profile === 'multator') {
    session.multator!.addPoint(event.x, event.y);
    return;
  }
  appendTonioEventBatch(session, event);
}

/**
 * Tonio uses a non-empty coalesced pointerup batch, otherwise the main event.
 * Multator (DrawField.onEndDraw) pushes the mouseup point too — unless the
 * gesture never moved and released where it pressed, which stays a dot. The
 * oldschool release (onOldEndDraw) adds nothing.
 */
export function finishStrokeEvent(session: StrokeSession, event: PointerSample): void {
  if (!event.isPrimary || event.pointerId !== session.pointerId) return;
  if (session.profile === 'toonio') {
    appendTonioEventBatch(session, event);
    return;
  }
  if (session.oldschool) return;
  const raw = session.rawPoints;
  if (raw.length === 2 && raw[0] === event.x && raw[1] === event.y) return;
  session.multator!.addPoint(event.x, event.y);
}

export function previewStrokeSession(session: StrokeSession): readonly number[] {
  if (session.own) {
    return session.rawPoints;
  }
  return session.profile === 'toonio'
    ? tonioSmooth(session.rawPoints, session.tonio.smooth)
    : session.rawPoints;
}

export function commitStrokeSession(session: StrokeSession): ResolvedStroke {
  // The reference measures its Lang tolerance on its own 600 px canvas, so
  // on a document of another size it scales the way the width does.
  const langScale = FIXED_POINT_SCALE / session.tonioCoordinateScale;
  if (session.oldschool && session.profile === 'multator') {
    const descriptor = session.descriptor;
    return {
      points: commitOldschoolStroke(
        session.rawPoints,
        descriptor.width / FIXED_POINT_SCALE,
        Math.random,
        OLDSCHOOL_LANG_TOLERANCE_LOGICAL * langScale,
      ),
      tool: descriptor.kind === 'pencil'
        ? { kind: 'contour', dialect: 'multator', color: descriptor.color }
        : { kind: 'contour-eraser', dialect: 'multator' },
    };
  }
  if (session.own) {
    // The tool collected these points; only its own thinning applies.
    const points = session.own.prepare
      ? session.own.prepare(session.rawPoints, session.descriptor.width, session.zoom)
      : session.rawPoints.slice();
    return { points, tool: copyLineTool(session.descriptor) };
  }
  const points = session.profile === 'multator'
    ? session.multator!.commit(LANG_TOLERANCE_DOC / session.tonioCoordinateScale).points
    : tonioPrepare(
        tonioSmooth(session.rawPoints, session.tonio.smooth),
        session.tonio.minDistance,
        session.zoom,
        session.tonioCoordinateScale,
      );
  return { points, tool: copyLineTool(session.descriptor) };
}

export function quantizeTonioPoint(xDoc: number, yDoc: number): [number, number] {
  return [Math.trunc(xDoc / FIXED_POINT_SCALE) * FIXED_POINT_SCALE, Math.trunc(yDoc / FIXED_POINT_SCALE) * FIXED_POINT_SCALE];
}

export function tonioSmooth(points: readonly number[], smooth: number): number[] {
  if (points.length === 0) return [];
  const result = [points[0], points[1]];
  const step = clampInteger(smooth, 1, 100) * 2;
  for (let i = 2; i < points.length - 2; i += step) result.push(points[i], points[i + 1]);
  const x = points[points.length - 2];
  const y = points[points.length - 1];
  result.push(x, y, x, y);
  return result;
}

export function tonioPrepare(
  points: readonly number[],
  minDistance: number,
  zoom: number,
  coordinateScale = 1,
): number[] {
  if (points.length <= 2) return points.slice();
  const result = [points[0], points[1]];
  const threshold = (clampInteger(minDistance, 0, 30) * FIXED_POINT_SCALE) / (zoom * positiveScale(coordinateScale));
  for (let i = 2; i < points.length - 2; i += 2) {
    const distance = Math.hypot(points[i - 2] - points[i], points[i - 1] - points[i + 1]);
    if (distance > threshold) result.push(points[i], points[i + 1]);
  }
  const x = points[points.length - 2];
  const y = points[points.length - 1];
  result.push(x, y, x, y);
  return result;
}

export class PointerStrokeController {
  #session: StrokeSession | null = null;
  #committed: ResolvedStroke | null = null;

  constructor(
    private readonly selection: () => {
      profile: StrokeDialect;
      descriptor: LineToolDescriptor;
      tonio?: TonioSettings;
      coordinateScale?: number;
      oldschool?: boolean;
      zoom?: number;
      /** Set when the tool collects its own points. */
      own?: OwnCapture;
    },
  ) {}

  get session(): StrokeSession | null { return this.#session; }

  pointerDown(event: PointerSample): boolean {
    if (!event.isPrimary || this.#session) return false;
    const selected = this.selection();
    this.#session = beginStrokeSession(
      selected.profile,
      event,
      selected.descriptor,
      selected.tonio,
      selected.coordinateScale,
      selected.oldschool ?? false,
      selected.zoom ?? 1,
      selected.own,
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
    this.#committed = commitStrokeSession(this.#session);
    this.#session = null;
    return true;
  }

  pointerCancel(event: PointerSample): boolean {
    if (!this.#session || !event.isPrimary || event.pointerId !== this.#session.pointerId) return false;
    if (this.#session.profile === 'toonio') {
      this.#committed = commitStrokeSession(this.#session);
    }
    this.#session = null;
    return true;
  }

  /**
   * Drops the session without committing it, unlike `pointerCancel`, which
   * still lands a Tonio stroke. A second finger on the canvas means the first
   * one was reaching for a gesture, not drawing.
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

function appendTonioEventBatch(session: StrokeSession, event: PointerSample): void {
  const coalesced = event.coalesced?.filter((sample) => sample.pointerId === session.pointerId);
  const samples = coalesced && coalesced.length > 0 ? coalesced : [event];
  if (session.own) {
    // The tool takes the batch as it is: it never sees the line dedup below.
    const flat: number[] = [];
    for (const sample of samples) flat.push(sample.x, sample.y);
    const collected = session.own.capture(session.rawPoints, flat, session.descriptor.width);
    session.rawPoints.length = 0;
    session.rawPoints.push(...collected);
    return;
  }
  let previousX: number | undefined;
  let previousY: number | undefined;
  for (const sample of samples) {
    const [x, y] = quantizeTonioPoint(sample.x, sample.y);
    if (x === previousX && y === previousY) continue;
    session.rawPoints.push(x, y);
    previousX = x;
    previousY = y;
  }
}

/**
 * A copy of the descriptor, so a session never hands the document an object
 * the caller still holds. A shallow copy is the whole of it: descriptors are
 * flat records of numbers and strings, whatever primitive they name.
 */
function copyLineTool(tool: LineToolDescriptor): LineToolDescriptor {
  return { ...tool };
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function positiveScale(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}
