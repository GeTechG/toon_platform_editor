import { FIXED_POINT_SCALE } from '../format/constants';
import type { LineToolDescriptor, PixelToolDescriptor, StrokeDialect } from '../format/types';
import type { ResolvedStroke } from '../model/operations';
import { StrokeBuilder } from './stroke-builder';
import { commitOldschoolStroke } from './oldschool';
import { appendPixelCells, pixelPrepare } from './pixel';

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
}

/** Tonio's pixel tool collects grid cells instead of a smoothed line. */
function isPixelSession(session: StrokeSession): boolean {
  return session.descriptor.kind === 'pixel';
}

export function beginStrokeSession(
  profile: StrokeDialect,
  event: PointerSample,
  descriptor: LineToolDescriptor,
  tonio: TonioSettings = DEFAULT_TONIO_SETTINGS,
  tonioCoordinateScale = 1,
  oldschool = false,
  zoom = 1,
): StrokeSession {
  // Feather and pixel exist only in the Tonio dialect; everything else takes
  // the profile the gesture started under.
  const frozenDescriptor = copyLineTool(
    descriptor.kind === 'feather' || descriptor.kind === 'pixel'
      ? descriptor
      : { ...descriptor, dialect: profile },
  );
  if (profile === 'multator') {
    const builder = new StrokeBuilder({
      width: frozenDescriptor.width,
      color: frozenDescriptor.kind === 'pencil' ? frozenDescriptor.color : '#000000',
      erase: frozenDescriptor.kind === 'eraser',
    });
    builder.addPoint(event.x, event.y);
    return {
      profile,
      pointerId: event.pointerId,
      descriptor: frozenDescriptor,
      rawPoints: builder.rawPoints as number[],
      tonio: { ...tonio },
      tonioCoordinateScale: 1,
      zoom: 1,
      multator: builder,
      oldschool,
    };
  }
  const session: StrokeSession = {
    profile,
    pointerId: event.pointerId,
    descriptor: frozenDescriptor,
    rawPoints: [],
    tonio: { smooth: clampInteger(tonio.smooth, 1, 100), minDistance: clampInteger(tonio.minDistance, 0, 30) },
    tonioCoordinateScale: positiveScale(tonioCoordinateScale),
    zoom: positiveScale(zoom),
    oldschool: false,
  };
  appendTonioEventBatch(session, event);
  return session;
}

export function appendStrokeEvent(session: StrokeSession, event: PointerSample): void {
  if (!event.isPrimary || event.pointerId !== session.pointerId) return;
  if (session.profile === 'multator') {
    session.multator!.addPoint(event.x, event.y);
    return;
  }
  appendTonioEventBatch(session, event);
}

/** Tonio uses a non-empty coalesced pointerup batch, otherwise the main event. */
export function finishStrokeEvent(session: StrokeSession, event: PointerSample): void {
  if (!event.isPrimary || event.pointerId !== session.pointerId || session.profile !== 'toonio') return;
  appendTonioEventBatch(session, event);
}

export function previewStrokeSession(session: StrokeSession): readonly number[] {
  if (isPixelSession(session)) {
    return session.rawPoints;
  }
  return session.profile === 'toonio'
    ? tonioSmooth(session.rawPoints, session.tonio.smooth)
    : session.rawPoints;
}

export function commitStrokeSession(session: StrokeSession): ResolvedStroke {
  if (session.oldschool && session.profile === 'multator') {
    const descriptor = session.descriptor;
    return {
      points: commitOldschoolStroke(session.rawPoints, descriptor.width / FIXED_POINT_SCALE),
      tool: descriptor.kind === 'pencil'
        ? { kind: 'contour', dialect: 'multator', color: descriptor.color }
        : { kind: 'contour-eraser', dialect: 'multator' },
    };
  }
  if (isPixelSession(session)) {
    // Reference Pixel: Smooth is the identity and Prepare thins by the width.
    const width = (session.descriptor as PixelToolDescriptor).width;
    return { points: pixelPrepare(session.rawPoints, width), tool: copyLineTool(session.descriptor) };
  }
  const points = session.profile === 'multator'
    ? session.multator!.commit().points
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
      tonioCoordinateScale?: number;
      oldschool?: boolean;
      zoom?: number;
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
      selected.tonioCoordinateScale,
      selected.oldschool ?? false,
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
  if (isPixelSession(session)) {
    // The pixel tool snaps to its own grid and drops cells the line already
    // holds, so it never sees the line dedup above.
    const width = (session.descriptor as PixelToolDescriptor).width;
    const flat: number[] = [];
    for (const sample of samples) flat.push(sample.x, sample.y);
    const cells = appendPixelCells(session.rawPoints, flat, width);
    session.rawPoints.length = 0;
    session.rawPoints.push(...cells);
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

function copyLineTool(tool: LineToolDescriptor): LineToolDescriptor {
  switch (tool.kind) {
    case 'pencil':
      return { kind: 'pencil', dialect: tool.dialect, width: tool.width, color: tool.color };
    case 'eraser':
      return { kind: 'eraser', dialect: tool.dialect, width: tool.width };
    case 'feather':
      return {
        kind: 'feather', dialect: 'toonio', width: tool.width, color: tool.color, fill: tool.fill,
      };
    case 'pixel':
      return { kind: 'pixel', dialect: 'toonio', width: tool.width, color: tool.color };
  }
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function positiveScale(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}
